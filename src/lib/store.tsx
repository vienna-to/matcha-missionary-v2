"use client";

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
import { reducer, type Action } from "./reducer";
import type { AppState, Event, MenuSnapshot, Order, OrderItem } from "./types";
import {
  getClient,
  isSupabaseConfigured,
  loadPairing,
  savePairing,
  clearPairing,
} from "./supabase/client";
import {
  fromEvent,
  fromIngredient,
  fromMenuItem,
  fromOrder,
  fromOrderItem,
  fromWorkspaceSettings,
  type DbEvent,
  type DbIngredient,
  type DbMenuItem,
  type DbOrder,
  type DbOrderItem,
  type DbWorkspace,
} from "./supabase/serialize";
import { joinWorkspace, loadFullState, subscribeAll } from "./supabase/sync";
import { writer, type Writer } from "./supabase/writer";

const STORAGE_KEY = "matcha-missionary:state:v1";
const CHANNEL_NAME = "matcha-missionary";

function loadLocalState(): AppState {
  if (typeof window === "undefined") return initialSeed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialSeed();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.settings || !parsed.menuItems) return initialSeed();
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
};

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
  | { phase: "needs-pairing" }
  | { phase: "loading"; workspaceId: string }
  | { phase: "ready"; workspaceId: string; code: string }
  | { phase: "error"; message: string };

function SupabaseStoreProvider({ children }: { children: React.ReactNode }) {
  const supabase = getClient()!;
  const [pairing, setPairing] = useState<PairingStatus>({ phase: "checking" });
  const [state, baseDispatch] = useReducer(reducer, undefined, () => initialSeed());

  // Restore prior pairing if present
  useEffect(() => {
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
        const snap = await loadFullState(supabase, wid);
        baseDispatch({ type: "REPLACE", state: snap });
        const code = snap.settings.workspaceCode;
        setPairing({ phase: "ready", workspaceId: wid, code });
      } catch (e: unknown) {
        setPairing({ phase: "error", message: (e as Error).message ?? String(e) });
      }
    })();
  }, [pairing.phase, pairing, supabase]);

  // Subscribe to realtime once ready
  useEffect(() => {
    if (pairing.phase !== "ready") return;
    const wid = pairing.workspaceId;
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
        const evt = fromEvent(row as DbEvent);
        const snap = (row as DbEvent).menu_snapshot as MenuSnapshot | undefined;
        baseDispatch({ type: "RT_UPSERT_EVENT", event: evt, snapshot: snap });
      },
      onOrder: (kind, row) => {
        if (kind === "DELETE") {
          baseDispatch({ type: "RT_DELETE_ORDER", id: row.id });
          return;
        }
        const r = row as DbOrder;
        // Build an Order shell without items; items arrive via order_items channel.
        const shell = fromOrder(r, []);
        const { items, ...orderNoItems } = shell;
        void items;
        baseDispatch({ type: "RT_UPSERT_ORDER", order: orderNoItems as Omit<Order, "items"> });
      },
      onOrderItem: (kind, row) => {
        if (kind === "DELETE") {
          const r = row as { id: string; order_id?: string };
          baseDispatch({ type: "RT_DELETE_ORDER_ITEM", id: r.id, orderId: r.order_id });
          return;
        }
        baseDispatch({ type: "RT_UPSERT_ORDER_ITEM", item: fromOrderItem(row as DbOrderItem) });
      },
      onWorkspace: (row) => {
        baseDispatch({ type: "RT_UPDATE_SETTINGS", patch: fromWorkspaceSettings(row as DbWorkspace) });
      },
    });
    return unsub;
  }, [pairing.phase, pairing, supabase]);

  // Build a write-mirroring dispatcher
  const w: Writer | null = useMemo(() => {
    if (pairing.phase !== "ready") return null;
    return writer(supabase, pairing.workspaceId);
  }, [pairing, supabase]);

  // Track the state across dispatches to look up data the writer needs.
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback(
    (a: Action) => {
      // Apply locally first (optimistic).
      baseDispatch(a);
      if (!w) return;

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
          w.updateIngredient(a.id, a.patch);
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
          setTimeout(() => {
            const latestEvt = stateRef.current.events.at(-1);
            const latestSnap = stateRef.current.menuSnapshots.at(-1);
            if (latestEvt && latestSnap) w.createEvent(latestEvt, latestSnap);
          }, 0);
          break;
        case "UPDATE_EVENT":
          w.updateEvent(a.id, a.patch);
          break;
        case "DELETE_EVENT":
          w.deleteEvent(a.id);
          break;
        case "SET_ACTIVE_EVENT":
          w.setActiveEvent(a.id);
          break;
        case "SUBMIT_ORDER":
          setTimeout(() => {
            const latest = stateRef.current.orders.at(-1);
            if (latest) w.submitOrder(latest);
          }, 0);
          break;
        case "UPDATE_ORDER":
          w.updateOrder(a.id, a.patch);
          break;
        case "DELETE_ORDER":
          w.deleteOrder(a.id);
          break;
        case "REPLACE_ORDER_ITEMS":
          setTimeout(() => {
            const o = stateRef.current.orders.find((x) => x.id === a.orderId);
            if (o) w.replaceOrderItems(a.orderId, o.items);
          }, 0);
          break;
        case "SET_ORDER_ITEM_STATUS":
          w.updateOrderItemStatus(a.orderItemId, a.status);
          break;
        default:
          // REPLACE / RESET_TO_SEED / RT_* are local-only.
          break;
      }
    },
    [w],
  );

  const activeEvent = useMemo(() => state.events.find((e) => e.isActive), [state.events]);

  const unpair = useCallback(() => {
    clearPairing();
    setPairing({ phase: "needs-pairing" });
  }, []);

  const workspaceId = pairing.phase === "ready" ? pairing.workspaceId : undefined;

  const value = useMemo<StoreCtx>(
    () => ({ state, dispatch, activeEvent, backend: "supabase", unpair, workspaceId }),
    [state, dispatch, activeEvent, unpair, workspaceId],
  );

  // While pairing or loading, show a small chrome instead of the app.
  if (pairing.phase === "checking" || pairing.phase === "loading") {
    return <FullscreenStatus title="loading workspace…" />;
  }
  if (pairing.phase === "needs-pairing") {
    return (
      <WorkspacePairing
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
}: {
  onPaired: (p: { workspaceId: string; code: string }) => void;
}) {
  const supabase = getClient()!;
  const [mode, setMode] = useState<"join" | "create">("create");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <span className="text-matcha-500">●</span> Matcha Missionary
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
