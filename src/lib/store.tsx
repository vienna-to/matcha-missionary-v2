"use client";

import { validateEventTimes } from "@/lib/event-times";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { initialSeed } from "./seed";
import { normalizeItemPatch } from "./pricing";
import { normalizeIngredientPatch } from "./prepared";
import { reducer, type Action } from "./reducer";
import { newId, nowIso } from "./id";
import type {
  AppState,
  Event,
  MenuSnapshot,
  Order,
  OrderItem,
  OrderRevision,
  OrderRevisionAction,
} from "./types";
import {
  getClient,
  isSupabaseConfigured,
  loadPairing,
  savePairing,
  clearPairing,
} from "./supabase/client";
import {
  fromRealtimeEvent,
  fromEventExtra,
  fromIngredient,
  fromInventoryPurchase,
  fromMenuItem,
  fromOrder,
  fromOrderItem,
  fromWorkspaceSettings,
  type DbEvent,
  type DbEventExtra,
  type DbIngredient,
  type DbInventoryPurchase,
  type DbMenuItem,
  type DbOrder,
  type DbOrderItem,
  type DbWorkspace,
} from "./supabase/serialize";
import {
  fetchActiveEventId,
  fetchEventOrders,
  fetchOrderWithItems,
  joinWorkspace,
  loadFullState,
  loadFullStateWithMeta,
  subscribeAll,
} from "./supabase/sync";
import { resetSyncStatus, setSyncStatus } from "./supabase/sync-status";
import { writer, type Writer } from "./supabase/writer";

const STORAGE_KEY = "matcha-missionary:state:v1";
const CHANNEL_NAME = "matcha-missionary";

/** Which UPDATE_ORDER patch keys we don't consider a "real" edit — these
 *  are barista workflow only (mark done, claim, pin) and shouldn't spam
 *  the audit trail. */
const ORDER_WORKFLOW_KEYS = new Set(["status", "doneAt", "queuePriority", "items"]);

/** Inspect a dispatched action and, if it mutates an order in a
 *  tax-relevant way, produce the snapshot to append to the audit trail.
 *  Returns null when the action is not audit-worthy or references an
 *  order we don't know about locally. */
function deriveOrderRevision(a: Action, state: AppState): OrderRevision | null {
  let orderId: string | null = null;
  let actionType: OrderRevisionAction | null = null;

  if (a.type === "UPDATE_ORDER") {
    const nonWorkflow = Object.keys(a.patch).filter((k) => !ORDER_WORKFLOW_KEYS.has(k));
    if (nonWorkflow.length === 0) return null;
    orderId = a.id;
    actionType = "update";
  } else if (a.type === "REPLACE_ORDER_ITEMS") {
    orderId = a.orderId;
    actionType = "replace_items";
  } else if (a.type === "UPDATE_ORDER_ITEM") {
    orderId = a.orderId;
    actionType = "update_item";
  } else if (a.type === "DELETE_ORDER") {
    orderId = a.id;
    actionType = "delete";
  }
  if (!orderId || !actionType) return null;

  const pre = state.orders.find((o) => o.id === orderId);
  if (!pre) return null;
  return {
    id: newId("rev"),
    orderId: pre.id,
    eventId: pre.eventId,
    orderNumber: pre.orderNumber,
    actionType,
    // Deep-ish clone so a later reducer mutation to the original order
    // doesn't rewrite the pre-image we've kept here.
    snapshot: { ...pre, items: pre.items.map((it) => ({ ...it })) },
    occurredAt: nowIso(),
  };
}

function loadLocalState(): AppState {
  if (typeof window === "undefined") return initialSeed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialSeed();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.settings || !parsed.menuItems) return initialSeed();
    // Backfill fields added in later releases so older payloads still work.
    if (!Array.isArray(parsed.inventoryPurchases)) parsed.inventoryPurchases = [];
    if (!Array.isArray(parsed.orderRevisions)) parsed.orderRevisions = [];
    if (!Array.isArray(parsed.eventExtras)) parsed.eventExtras = [];
    return parsed;
  } catch {
    return initialSeed();
  }
}

type StoreCtx = {
  state: AppState;
  dispatch: (a: Action) => void;
  activeEvent: Event | undefined;
  /** "local" = localStorage adapter, "supabase" = synced over the network. */
  backend: "local" | "supabase";
  /** Drop the workspace pairing (Supabase mode only). */
  unpair?: () => void;
  /** Current Supabase workspace UUID (Supabase mode only). */
  workspaceId?: string;
  /** Re-read one order (with its items) from the server. Resolves true if the
   *  order exists and has items. Supabase mode only. */
  refreshOrder?: (orderId: string) => Promise<boolean>;
  /** Rebuild the realtime connection and do a full refetch right now. */
  syncNow?: () => void;
};

const POLL_MS = 5_000;
const FULL_RESYNC_EVERY_TICKS = 12; // ~60s safety net on top of the 5s poll
const UNSYNCED_RETRY_EVERY_TICKS = 6; // ~30s
/** A poll/refetch result is discarded if we wrote locally this recently: the
 *  write may still be in flight and the read could predate it. */
const WRITE_GUARD_MS = 2_000;
/** Wait this long after the last item event of an order before re-reading it,
 *  so an edit's DELETE + INSERT burst collapses into one consistent read. */
const ORDER_REFRESH_DEBOUNCE_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const StoreContext = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  if (isSupabaseConfigured()) {
    return <SupabaseStoreProvider>{children}</SupabaseStoreProvider>;
  }
  return <LocalStoreProvider>{children}</LocalStoreProvider>;
}

// ---------------------------------------------------------------------------
// Local adapter (localStorage + BroadcastChannel)
// ---------------------------------------------------------------------------

function LocalStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, loadLocalState);
  const isRemoteRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      if (e.data?.type === "state") {
        isRemoteRef.current = true;
        baseDispatch({ type: "REPLACE", state: e.data.state as AppState });
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
    if (isRemoteRef.current) {
      isRemoteRef.current = false;
      return;
    }
    try {
      channelRef.current?.postMessage({ type: "state", state });
    } catch {}
  }, [state]);

  const dispatch = useCallback((a: Action) => baseDispatch(a), []);
  const activeEvent = useMemo(() => state.events.find((e) => e.isActive), [state.events]);

  const value = useMemo<StoreCtx>(
    () => ({ state, dispatch, activeEvent, backend: "local" }),
    [state, dispatch, activeEvent],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// ---------------------------------------------------------------------------
// Supabase adapter — pairing, load, subscribe, mirror writes
// ---------------------------------------------------------------------------

type PairingStatus =
  | { phase: "checking" }
  | { phase: "needs-pairing"; error?: string }
  | { phase: "loading"; workspaceId: string }
  | { phase: "ready"; workspaceId: string; code: string }
  | { phase: "error"; message: string };

function SupabaseStoreProvider({ children }: { children: React.ReactNode }) {
  const supabase = getClient()!;
  const [pairing, setPairing] = useState<PairingStatus>({ phase: "checking" });
  const [state, baseDispatch] = useReducer(reducer, undefined, () => initialSeed());

  // Restore prior pairing if present
  useEffect(() => {
    // ?workspace=CODE takes precedence over any cached pairing — a shared link
    // is an explicit request to open that workspace.
    const urlCode =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("workspace")?.trim().toUpperCase() || null
        : null;

    if (urlCode) {
      (async () => {
        try {
          const { id, code } = await joinWorkspace(supabase, urlCode);
          savePairing({ workspaceId: id, code });
          // Strip the param so refreshes don't re-run this branch.
          const url = new URL(window.location.href);
          url.searchParams.delete("workspace");
          window.history.replaceState(null, "", url.toString());
          setPairing({ phase: "loading", workspaceId: id });
        } catch {
          setPairing({ phase: "needs-pairing", error: "Workspace not found." });
        }
      })();
      return;
    }

    const existing = loadPairing();
    if (!existing) {
      setPairing({ phase: "needs-pairing" });
      return;
    }
    // No server-side session work needed with RLS off; the code is just a
    // local filter key. Verify the workspace still exists before loading.
    (async () => {
      try {
        await joinWorkspace(supabase, existing.code);
        setPairing({ phase: "loading", workspaceId: existing.workspaceId });
      } catch (e) {
        console.warn("[supabase] cached pairing invalid, clearing", e);
        clearPairing();
        setPairing({ phase: "needs-pairing" });
      }
    })();
  }, [supabase]);

  // Load full state once we have a workspace
  useEffect(() => {
    if (pairing.phase !== "loading") return;
    const wid = pairing.workspaceId;
    (async () => {
      try {
        const { state: snap, extrasUnavailable } = await loadFullStateWithMeta(supabase, wid);
        extrasAvailableRef.current = !extrasUnavailable;
        baseDispatch({ type: "REPLACE", state: snap });
        const code = snap.settings.workspaceCode;
        setPairing({ phase: "ready", workspaceId: wid, code });
      } catch (e: unknown) {
        setPairing({ phase: "error", message: (e as Error).message ?? String(e) });
      }
    })();
  }, [pairing.phase, pairing, supabase]);

  // Track the state across dispatches to look up data the writer needs.
  const stateRef = useRef(state);
  stateRef.current = state;
  /** False until event_extras has been read successfully: until then we do
   *  not bind its realtime feed (a missing table would fail the channel). */
  const extrasAvailableRef = useRef(false);

  // ---- sync bookkeeping ----
  const lastWriteAtRef = useRef(0);
  /** Orders submitted here whose write isn't confirmed yet. A refetch must
   *  not drop them. */
  const pendingOrdersRef = useRef(new Set<string>());
  /** Subset that failed every retry; re-attempted periodically. */
  const unsyncedRef = useRef(new Map<string, Order>());
  const submittingRef = useRef(new Set<string>());
  const fetchingOrdersRef = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const lastFullAtRef = useRef(0);
  const flushUnsyncedRef = useRef<() => void>(() => {});
  const [channelNonce, setChannelNonce] = useState(0);

  const workspaceIdForSync = pairing.phase === "ready" ? pairing.workspaceId : null;

  /** Read the full order (with items) and put it in state. Used whenever an
   *  order or item event references an order we don't hold yet, so a card is
   *  only ever created from a complete read, never as an empty shell. */
  const fetchFullOrder = useCallback(
    async (orderId: string): Promise<boolean> => {
      if (!workspaceIdForSync) return false;
      if (fetchingOrdersRef.current.has(orderId)) return false;
      fetchingOrdersRef.current.add(orderId);
      try {
        for (let i = 0; i < 3; i++) {
          try {
            const o = await fetchOrderWithItems(supabase, workspaceIdForSync, orderId);
            setSyncStatus({ lastOkAt: Date.now() });
            if (!o) return false; // deleted meanwhile
            baseDispatch({ type: "RT_SET_ORDER", order: o });
            if (o.items.length > 0) return true;
          } catch (e) {
            console.warn("[sync] fetchFullOrder failed", orderId, e);
          }
          await sleep(600 * (i + 1));
        }
        return false;
      } finally {
        fetchingOrdersRef.current.delete(orderId);
      }
    },
    [supabase, workspaceIdForSync],
  );

  /** "poll": the active event's orders + items (cheap, every 5s).
   *  "full": everything (wake / focus / reconnect / every ~60s). */
  const resync = useCallback(
    async (mode: "poll" | "full") => {
      if (!workspaceIdForSync) return;
      if (syncingRef.current) return;
      syncingRef.current = true;
      const startedAt = Date.now();
      const stale = () => lastWriteAtRef.current > startedAt - WRITE_GUARD_MS;
      try {
        if (mode === "poll") {
          const local = stateRef.current.events.find((e) => e.isActive);
          const serverActiveId = await fetchActiveEventId(supabase, workspaceIdForSync);
          if (serverActiveId !== (local?.id ?? null)) {
            // Active event changed on another device: pull everything.
            const { state: snap, extrasUnavailable } = await loadFullStateWithMeta(
              supabase,
              workspaceIdForSync,
            );
            extrasAvailableRef.current = !extrasUnavailable;
            setSyncStatus({ lastOkAt: Date.now() });
            lastFullAtRef.current = Date.now();
            if (!stale()) {
              baseDispatch({
                type: "RT_SYNC_FULL",
                state: snap,
                keepIds: [...pendingOrdersRef.current],
                extrasUnavailable,
              });
            }
            return;
          }
          if (!local) {
            setSyncStatus({ lastOkAt: Date.now() });
            return;
          }
          const orders = await fetchEventOrders(supabase, workspaceIdForSync, local.id);
          setSyncStatus({ lastOkAt: Date.now() });
          if (stale()) return;
          baseDispatch({
            type: "RT_SYNC_ORDERS",
            orders,
            scopeEventId: local.id,
            keepIds: [...pendingOrdersRef.current],
          });
        } else {
          const { state: snap, extrasUnavailable } = await loadFullStateWithMeta(
            supabase,
            workspaceIdForSync,
          );
          extrasAvailableRef.current = !extrasUnavailable;
          setSyncStatus({ lastOkAt: Date.now() });
          lastFullAtRef.current = Date.now();
          if (stale()) return;
          baseDispatch({
            type: "RT_SYNC_FULL",
            state: snap,
            keepIds: [...pendingOrdersRef.current],
            extrasUnavailable,
          });
        }
      } catch (e) {
        console.warn(`[sync] ${mode} resync failed`, e);
      } finally {
        syncingRef.current = false;
      }
    },
    [supabase, workspaceIdForSync],
  );
  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  const syncNow = useCallback(() => {
    setChannelNonce((n) => n + 1);
    void resyncRef.current("full");
  }, []);

  // Subscribe to realtime once ready
  useEffect(() => {
    if (pairing.phase !== "ready") return;
    const wid = pairing.workspaceId;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // Debounced whole-order reads for item replacements (see onOrderItem).
    const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const refreshOrderSoon = (orderId: string) => {
      clearTimeout(refreshTimers.get(orderId));
      refreshTimers.set(
        orderId,
        setTimeout(() => {
          refreshTimers.delete(orderId);
          if (!disposed) void fetchFullOrder(orderId);
        }, ORDER_REFRESH_DEBOUNCE_MS),
      );
    };
    const unsub = subscribeAll(supabase, wid, {
      onIngredient: (kind, row) => {
        if (kind === "DELETE") baseDispatch({ type: "RT_DELETE_INGREDIENT", id: row.id });
        else baseDispatch({ type: "RT_UPSERT_INGREDIENT", ing: fromIngredient(row as DbIngredient) });
      },
      onMenuItem: (kind, row) => {
        if (kind === "DELETE") baseDispatch({ type: "RT_DELETE_MENU_ITEM", id: row.id });
        else baseDispatch({ type: "RT_UPSERT_MENU_ITEM", item: fromMenuItem(row as DbMenuItem) });
      },
      onEvent: (kind, row) => {
        if (kind === "DELETE") {
          baseDispatch({ type: "RT_DELETE_EVENT", id: row.id });
          return;
        }
        const evt = fromRealtimeEvent(
          row as DbEvent,
          stateRef.current.events.find((e) => e.id === row.id),
          kind,
        );
        const snap = (row as DbEvent).menu_snapshot as MenuSnapshot | undefined;
        baseDispatch({ type: "RT_UPSERT_EVENT", event: evt, snapshot: snap });
      },
      onOrder: (kind, row) => {
        if (kind === "DELETE") {
          baseDispatch({ type: "RT_DELETE_ORDER", id: row.id });
          return;
        }
        const r = row as DbOrder;
        if (!stateRef.current.orders.some((o) => o.id === r.id)) {
          // New to this device: never build an item-less shell (that was the
          // blank barista card). Read the order together with its items.
          void fetchFullOrder(r.id);
          return;
        }
        // Known order: only order-level fields changed; keep our items.
        const shell = fromOrder(r, []);
        const { items, ...orderNoItems } = shell;
        void items;
        baseDispatch({ type: "RT_UPSERT_ORDER", order: orderNoItems as Omit<Order, "items"> });
      },
      onOrderItem: (kind, row) => {
        if (kind === "DELETE") {
          const r = row as { id: string; order_id?: string };
          // A DELETE payload only carries the id, so find the order locally.
          const orderId =
            r.order_id ?? stateRef.current.orders.find((o) => o.items.some((it) => it.id === r.id))?.id;
          if (orderId && stateRef.current.orders.some((o) => o.id === orderId)) {
            // An edit replaces items as a burst of DELETE + INSERT events. Don't
            // apply them one by one (that shows an empty or mixed order); read
            // the whole order once the burst has settled.
            refreshOrderSoon(orderId);
            return;
          }
          baseDispatch({ type: "RT_DELETE_ORDER_ITEM", id: r.id, orderId: r.order_id });
          return;
        }
        const item = fromOrderItem(row as DbOrderItem);
        const known = stateRef.current.orders.find((o) => o.id === item.orderId);
        if (!known) {
          // Item arrived before (or without) its order event.
          void fetchFullOrder(item.orderId);
          return;
        }
        if (kind === "INSERT" && !known.items.some((it) => it.id === item.id)) {
          // A row we don't hold: part of an item replacement from another device.
          refreshOrderSoon(item.orderId);
          return;
        }
        baseDispatch({ type: "RT_UPSERT_ORDER_ITEM", item });
      },
      onInventory: (kind, row) => {
        if (kind === "DELETE") {
          baseDispatch({ type: "RT_DELETE_INVENTORY_PURCHASE", id: row.id });
          return;
        }
        baseDispatch({
          type: "RT_UPSERT_INVENTORY_PURCHASE",
          purchase: fromInventoryPurchase(row as DbInventoryPurchase),
        });
      },
      onEventExtra: (kind, row) => {
        if (kind === "DELETE") {
          baseDispatch({ type: "RT_DELETE_EVENT_EXTRA", id: row.id });
          return;
        }
        baseDispatch({
          type: "RT_UPSERT_EVENT_EXTRA",
          extra: fromEventExtra(row as DbEventExtra),
        });
      },
      onWorkspace: (row) => {
        baseDispatch({ type: "RT_UPDATE_SETTINGS", patch: fromWorkspaceSettings(row as DbWorkspace) });
      },
    }, (status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        setSyncStatus({ channelUp: true });
        // Anything that happened while we were disconnected was never
        // replayed, so close the gap with a full read.
        void resyncRef.current("full");
        return;
      }
      setSyncStatus({ channelUp: false });
      // Rebuild the channel ourselves; a tablet that slept can hold a dead
      // socket that never recovers on its own.
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!disposed) setChannelNonce((n) => n + 1);
      }, 2_000);
    }, { includeExtras: extrasAvailableRef.current });
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      for (const t of refreshTimers.values()) clearTimeout(t);
      unsub();
    };
  }, [pairing.phase, pairing, supabase, channelNonce, fetchFullOrder]);

  // Switch the sync badge on with the provider; clear it on unpair/unmount.
  useEffect(() => {
    if (pairing.phase !== "ready") return;
    setSyncStatus({ enabled: true, lastOkAt: Date.now() });
    return () => resetSyncStatus();
  }, [pairing.phase]);

  // Fallback poll every 5s (+ a full refetch about every minute, and a retry
  // of unsaved orders about every 30s) so a dropped realtime connection can't
  // leave a screen behind for long.
  useEffect(() => {
    if (pairing.phase !== "ready") return;
    let tick = 0;
    const t = setInterval(() => {
      if (document.hidden) return;
      tick++;
      void resyncRef.current(tick % FULL_RESYNC_EVERY_TICKS === 0 ? "full" : "poll");
      if (tick % UNSYNCED_RETRY_EVERY_TICKS === 0) flushUnsyncedRef.current();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pairing.phase]);

  // Wake from sleep / tab regains focus / network returns: rebuild the socket
  // if we were away a while, and refetch everything.
  useEffect(() => {
    if (pairing.phase !== "ready") return;
    let hiddenAt = 0;
    const wake = (rebuild: boolean) => {
      if (rebuild) setChannelNonce((n) => n + 1);
      void resyncRef.current("full");
      flushUnsyncedRef.current();
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      wake(away > 4_000);
    };
    const onFocus = () => {
      if (Date.now() - lastFullAtRef.current > 2_000) wake(false);
    };
    const onOnline = () => wake(true);
    const onOffline = () => setSyncStatus({ channelUp: false });
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) wake(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pairing.phase]);

  // Build a write-mirroring dispatcher
  const w: Writer | null = useMemo(() => {
    if (pairing.phase !== "ready") return null;
    return writer(supabase, pairing.workspaceId);
  }, [pairing, supabase]);

  /** Save an order to the server, retrying; keeps it protected from refetches
   *  and visible in the sync badge until it is confirmed saved. */
  const submitWithRetry = useCallback(
    async (order: Order) => {
      if (!w || submittingRef.current.has(order.id)) return;
      submittingRef.current.add(order.id);
      pendingOrdersRef.current.add(order.id);
      try {
        for (const delay of [0, 3_000, 10_000, 30_000]) {
          if (delay) await sleep(delay);
          // Deleted locally while we were retrying: stop. (Skipped on the
          // first pass: the reducer's update may not have rendered yet.)
          if (delay && !stateRef.current.orders.some((o) => o.id === order.id)) {
            pendingOrdersRef.current.delete(order.id);
            unsyncedRef.current.delete(order.id);
            setSyncStatus({ unsynced: unsyncedRef.current.size });
            return;
          }
          const result = await w.submitOrder(order);
          if ("finalOrderNumber" in result) {
            if (result.finalOrderNumber !== order.orderNumber) {
              baseDispatch({
                type: "UPDATE_ORDER",
                id: order.id,
                patch: { orderNumber: result.finalOrderNumber },
              });
            }
            lastWriteAtRef.current = Date.now();
            pendingOrdersRef.current.delete(order.id);
            unsyncedRef.current.delete(order.id);
            setSyncStatus({ unsynced: unsyncedRef.current.size });
            return;
          }
          unsyncedRef.current.set(order.id, order);
          setSyncStatus({ unsynced: unsyncedRef.current.size });
        }
      } finally {
        submittingRef.current.delete(order.id);
      }
    },
    [w],
  );

  flushUnsyncedRef.current = () => {
    for (const o of unsyncedRef.current.values()) void submitWithRetry(o);
  };

  const refreshOrder = useCallback(
    (orderId: string) => fetchFullOrder(orderId),
    [fetchFullOrder],
  );

  const dispatch = useCallback(
    (action: Action) => {
      // Ingredient edits are brought within the prepared-ingredient rules first, so
      // the database receives exactly what the reducer applies.
      // The ingredient as it was before this edit, for the writer (see updateIngredient).
      const prevIngredient =
        action.type === "UPDATE_INGREDIENT"
          ? stateRef.current.ingredients.find((i) => i.id === action.id)
          : undefined;
      const a: Action =
        action.type === "UPDATE_INGREDIENT"
          ? { ...action, patch: normalizeIngredientPatch(stateRef.current.ingredients, action.id, action.patch) }
          : action;
      // Snapshot BEFORE the mutation lands — the reducer will overwrite the
      // order in-place, so we have to capture the pre-change state now.
      // Only tax-relevant edits are recorded. Barista workflow (status /
      // doneAt / queuePriority / in-progress claim) is noise, so skip it.
      const revision = w ? deriveOrderRevision(a, stateRef.current) : null;

      // Apply locally first (optimistic).
      baseDispatch(a);
      if (!w) return;
      if (!a.type.startsWith("RT_")) lastWriteAtRef.current = Date.now();

      if (revision) {
        baseDispatch({ type: "APPEND_ORDER_REVISION", revision });
        w.writeOrderRevision(revision);
      }

      // Mirror to Supabase based on action type.
      switch (a.type) {
        case "UPDATE_SETTINGS":
          w.updateSettings(a.patch);
          break;
        case "ADD_INGREDIENT": {
          // Reducer assigned an id we don't have here; find the newly-added one
          // from the next state via a microtask. Simpler: re-create deterministic
          // ID locally before dispatch upstream. For now, query latest state.
          setTimeout(() => {
            const latest = stateRef.current.ingredients.at(-1);
            if (latest) w.addIngredient(latest);
          }, 0);
          break;
        }
        case "UPDATE_INGREDIENT":
          w.updateIngredient(a.id, a.patch, prevIngredient);
          break;
        case "DELETE_INGREDIENT":
          w.deleteIngredient(a.id);
          break;
        case "ADD_MENU_ITEM":
          setTimeout(() => {
            const latest = stateRef.current.menuItems.at(-1);
            if (latest) w.addMenuItem(latest);
          }, 0);
          break;
        case "UPDATE_MENU_ITEM":
          w.updateMenuItem(a.id, a.patch);
          break;
        case "DELETE_MENU_ITEM":
          w.deleteMenuItem(a.id);
          break;
        case "CREATE_EVENT":
          // The reducer rejects bad times; don't re-write the previous event.
          if (validateEventTimes(a.event.startTime, a.event.endTime)) break;
          setTimeout(() => {
            const latestEvt = stateRef.current.events.at(-1);
            const latestSnap = stateRef.current.menuSnapshots.at(-1);
            if (latestEvt && latestSnap) w.createEvent(latestEvt, latestSnap);
          }, 0);
          break;
        case "UPDATE_EVENT":
          if (
            (a.patch.startTime || a.patch.endTime) &&
            validateEventTimes(
              a.patch.startTime ?? stateRef.current.events.find((e) => e.id === a.id)?.startTime,
              a.patch.endTime ?? stateRef.current.events.find((e) => e.id === a.id)?.endTime,
            )
          )
            break;
          w.updateEvent(a.id, a.patch);
          break;
        case "DELETE_EVENT":
          w.deleteEvent(a.id);
          break;
        case "SET_ACTIVE_EVENT":
          w.setActiveEvent(a.id);
          break;
        case "SUBMIT_ORDER":
          // Use the action's order directly (no setTimeout/stateRef lookup) so
          // two rapid submits don't race and write the same "latest" order twice.
          // The writer may bump orderNumber on a unique-constraint collision;
          // reflect that locally so the submitter's device and the RT echoes
          // to other devices agree on the final number.
          void submitWithRetry(a.order);
          break;
        case "UPDATE_ORDER":
          w.updateOrder(a.id, a.patch);
          // Bulk item-status changes (markComplete flips everything to "done",
          // reopen flips everything to "pending") arrive on the order-level
          // patch. toOrderPatch drops the items array, so per-item statuses
          // never reach Supabase without this fan-out. Only status is worth
          // syncing — other item fields aren't touched by these bulk ops.
          if (a.patch.items) {
            for (const it of a.patch.items) {
              w.updateOrderItemStatus(it.id, it.status);
            }
          }
          break;
        case "DELETE_ORDER": {
          pendingOrdersRef.current.delete(a.id);
          if (unsyncedRef.current.delete(a.id)) {
            setSyncStatus({ unsynced: unsyncedRef.current.size });
          }
          w.deleteOrder(a.id);
          break;
        }
        case "REPLACE_ORDER_ITEMS":
          setTimeout(() => {
            const o = stateRef.current.orders.find((x) => x.id === a.orderId);
            if (o) w.replaceOrderItems(a.orderId, o.items);
          }, 0);
          break;
        case "SET_ORDER_ITEM_STATUS": {
          w.updateOrderItemStatus(a.orderItemId, a.status);
          // Mirror any derived order-level status change (pending → completed
          // when all items done, or completed → pending when reopened) to
          // Supabase so both devices agree. Without this, the DB status
          // drifts and a refresh restores the wrong queue state.
          const preOrder = stateRef.current.orders.find((o) => o.id === a.orderId);
          if (preOrder && preOrder.status !== "cancelled") {
            const nextItems = preOrder.items.map((it) =>
              it.id === a.orderItemId ? { ...it, status: a.status } : it,
            );
            const allDone = nextItems.length > 0 && nextItems.every((it) => it.status === "done");
            const nextStatus = allDone
              ? "completed"
              : preOrder.status === "in_progress"
                ? "in_progress"
                : "pending";
            if (nextStatus !== preOrder.status) {
              const patch: Parameters<typeof w.updateOrder>[1] = { status: nextStatus };
              if (nextStatus === "completed") patch.doneAt = new Date().toISOString();
              if (nextStatus !== "completed" && preOrder.doneAt) patch.doneAt = undefined;
              w.updateOrder(a.orderId, patch);
            }
          }
          break;
        }
        case "UPDATE_ORDER_ITEM": {
          // A discount change must also carry the new price_charged (and
          // clear a stale free reason) so the database matches the screen.
          const cur = stateRef.current.orders
            .find((o) => o.id === a.orderId)
            ?.items.find((it) => it.id === a.orderItemId);
          w.updateOrderItem(a.orderItemId, cur ? normalizeItemPatch(cur, a.patch) : a.patch);
          break;
        }
        case "ADD_EVENT_EXTRA":
          setTimeout(() => {
            const latest = stateRef.current.eventExtras.at(-1);
            if (latest) w.addEventExtra(latest);
          }, 0);
          break;
        case "UPDATE_EVENT_EXTRA":
          w.updateEventExtra(a.id, a.patch);
          break;
        case "DELETE_EVENT_EXTRA":
          w.deleteEventExtra(a.id);
          break;
        case "ADD_INVENTORY_PURCHASE":
          setTimeout(() => {
            const latest = stateRef.current.inventoryPurchases.at(-1);
            if (latest) w.addInventoryPurchase(latest);
          }, 0);
          break;
        case "UPDATE_INVENTORY_PURCHASE":
          w.updateInventoryPurchase(a.id, a.patch);
          break;
        case "DELETE_INVENTORY_PURCHASE":
          w.deleteInventoryPurchase(a.id);
          break;
        default:
          // REPLACE / RESET_TO_SEED / RT_* are local-only.
          break;
      }
    },
    [w, submitWithRetry],
  );

  const activeEvent = useMemo(() => state.events.find((e) => e.isActive), [state.events]);

  const unpair = useCallback(() => {
    clearPairing();
    setPairing({ phase: "needs-pairing" });
  }, []);

  const workspaceId = pairing.phase === "ready" ? pairing.workspaceId : undefined;

  const value = useMemo<StoreCtx>(
    () => ({
      state,
      dispatch,
      activeEvent,
      backend: "supabase",
      unpair,
      workspaceId,
      refreshOrder,
      syncNow,
    }),
    [state, dispatch, activeEvent, unpair, workspaceId, refreshOrder, syncNow],
  );

  // While pairing or loading, show a small chrome instead of the app.
  if (pairing.phase === "checking" || pairing.phase === "loading") {
    return <FullscreenStatus title="loading workspace…" />;
  }
  if (pairing.phase === "needs-pairing") {
    return (
      <WorkspacePairing
        initialError={pairing.error}
        onPaired={(p) => {
          savePairing(p);
          setPairing({ phase: "loading", workspaceId: p.workspaceId });
        }}
      />
    );
  }
  if (pairing.phase === "error") {
    return <FullscreenStatus title="something went wrong" message={pairing.message} />;
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function FullscreenStatus({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-6">
      <div className="text-center">
        <div className="t-display text-2xl text-matcha-700">{title}</div>
        {message ? <div className="t-caption mt-2 text-sm text-matcha-900/60">{message}</div> : null}
      </div>
    </div>
  );
}

// Inline pairing UI to avoid an extra file dependency.
import { Button, Card, Field, Input } from "@/components/ui";
import { createWorkspace, joinWorkspace as joinWs } from "./supabase/sync";

function WorkspacePairing({
  onPaired,
  initialError,
}: {
  onPaired: (p: { workspaceId: string; code: string }) => void;
  initialError?: string;
}) {
  const supabase = getClient()!;
  // When we arrived here from a failed ?workspace= join, default to the join
  // tab so the user can immediately correct the code.
  const [mode, setMode] = useState<"join" | "create">(initialError ? "join" : "create");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  function newCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  async function handleJoin() {
    setBusy(true);
    setError(null);
    try {
      const { id, code: c } = await joinWs(supabase, code.trim().toUpperCase());
      onPaired({ workspaceId: id, code: c });
    } catch (e: unknown) {
      setError((e as Error).message ?? "could not join");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const c = code.trim().toUpperCase() || newCode();
      const { id, code: created } = await createWorkspace(supabase, c);
      onPaired({ workspaceId: id, code: created });
    } catch (e: unknown) {
      setError((e as Error).message ?? "could not create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-6 py-12">
      <Card className="w-full max-w-md space-y-5">
        <div>
          <div className="t-brand text-2xl">
            <span className="text-matcha-500">●</span> matcha missionary
          </div>
          <p className="t-caption mt-1 text-sm text-matcha-900/60">
            create a workspace or join an existing one with a code.
          </p>
        </div>

        <div className="flex gap-2 rounded-xl bg-cream-100 p-1">
          <button
            onClick={() => setMode("create")}
            className={`t-display flex-1 rounded-lg py-2 text-xs ${
              mode === "create" ? "bg-white text-matcha-900 shadow-sm" : "text-matcha-900/60"
            }`}
          >
            create
          </button>
          <button
            onClick={() => setMode("join")}
            className={`t-display flex-1 rounded-lg py-2 text-xs ${
              mode === "join" ? "bg-white text-matcha-900 shadow-sm" : "text-matcha-900/60"
            }`}
          >
            join with code
          </button>
        </div>

        {mode === "create" ? (
          <>
            <Field label="workspace code (optional, leave blank for random)">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. MATCHA"
                maxLength={6}
              />
            </Field>
            <Button onClick={handleCreate} disabled={busy} className="w-full">
              {busy ? "creating…" : "create workspace"}
            </Button>
          </>
        ) : (
          <>
            <Field label="workspace code">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="enter the 6-char code"
                maxLength={6}
              />
            </Field>
            <Button onClick={handleJoin} disabled={busy || code.trim().length === 0} className="w-full">
              {busy ? "joining…" : "join workspace"}
            </Button>
          </>
        )}

        {error ? (
          <div className="t-caption rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {error}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function useActiveEvent(): Event | undefined {
  return useStore().activeEvent;
}

export function useDispatch(): (a: Action) => void {
  return useStore().dispatch;
}

// Re-exports kept for callers that destructure (unchanged surface).
export type { OrderItem };
