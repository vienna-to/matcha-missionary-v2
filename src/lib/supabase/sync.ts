import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppState, Order } from "@/lib/types";
import {
  buildAppState,
  fromEvent,
  fromIngredient,
  fromEventExtra,
  fromInventoryPurchase,
  fromMenuItem,
  fromOrder,
  fromOrderItem,
  type DbEvent,
  type DbEventExtra,
  type DbIngredient,
  type DbInventoryPurchase,
  type DbMenuItem,
  type DbOrder,
  type DbOrderItem,
  type DbOrderRevision,
  type DbWorkspace,
} from "./serialize";

// ---------- Loading ----------

export async function loadFullState(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AppState> {
  return (await loadFullStateWithMeta(supabase, workspaceId)).state;
}

/** Same as loadFullState, plus whether event_extras could be read. When the
 *  table is missing (migration not run) callers keep their local extras and
 *  skip the realtime binding, which would otherwise error the whole channel. */
export async function loadFullStateWithMeta(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ state: AppState; extrasUnavailable: boolean }> {
  const [
    { data: ws, error: wsErr },
    { data: ings, error: ingErr },
    { data: items, error: miErr },
    { data: events, error: evErr },
    { data: orders, error: ordErr },
    { data: orderItems, error: oiErr },
    { data: invs, error: invErr },
    revsResult,
    extrasResult,
  ] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspaceId).single(),
    supabase.from("ingredients").select("*").eq("workspace_id", workspaceId),
    supabase.from("menu_items").select("*").eq("workspace_id", workspaceId),
    supabase.from("events").select("*").eq("workspace_id", workspaceId),
    supabase.from("orders").select("*").eq("workspace_id", workspaceId),
    supabase.from("order_items").select("*").eq("workspace_id", workspaceId),
    supabase.from("inventory_purchases").select("*").eq("workspace_id", workspaceId),
    // order_revisions is a new table — tolerate its absence (pre-migration
    // Supabase deploys) so the app still loads. Only real problems throw.
    supabase.from("order_revisions").select("*").eq("workspace_id", workspaceId),
    // event_extras is new too (migration-order-tips-and-extras.sql).
    supabase.from("event_extras").select("*").eq("workspace_id", workspaceId),
  ]);

  const err = wsErr || ingErr || miErr || evErr || ordErr || oiErr || invErr;
  if (err) throw err;
  if (!ws) throw new Error("workspace not found");

  // Tolerate a missing order_revisions table (fresh deploy hasn't run the
  // migration yet) — we log and continue with an empty audit trail.
  let revs: DbOrderRevision[] = [];
  if (revsResult.error) {
    console.warn("[supabase] order_revisions load failed", revsResult.error);
  } else {
    revs = (revsResult.data ?? []) as DbOrderRevision[];
  }

  let extras: DbEventExtra[] = [];
  const extrasUnavailable = Boolean(extrasResult.error);
  if (extrasResult.error) {
    console.warn(
      "[supabase] event_extras load failed. Run supabase/migration-order-tips-and-extras.sql.",
      extrasResult.error,
    );
  } else {
    extras = (extrasResult.data ?? []) as DbEventExtra[];
  }

  const state = buildAppState(
    ws as DbWorkspace,
    (ings ?? []) as DbIngredient[],
    (items ?? []) as DbMenuItem[],
    (events ?? []) as DbEvent[],
    (orders ?? []) as DbOrder[],
    (orderItems ?? []) as DbOrderItem[],
    (invs ?? []) as DbInventoryPurchase[],
    revs,
    extras,
  );
  return { state, extrasUnavailable };
}

// ---------- Targeted reads (poll / single-order refetch) ----------
//
// An order is read together with its items in ONE request (PostgREST embed),
// so the result is a consistent snapshot — never an order without the items
// that were committed with it.

type DbOrderWithItems = DbOrder & { order_items: DbOrderItem[] | null };

function toOrder(r: DbOrderWithItems): Order {
  return fromOrder(r, (r.order_items ?? []).map(fromOrderItem));
}

export async function fetchEventOrders(
  supabase: SupabaseClient,
  workspaceId: string,
  eventId: string,
): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("workspace_id", workspaceId)
    .eq("event_id", eventId);
  if (error) throw error;
  return ((data ?? []) as DbOrderWithItems[]).map(toOrder);
}

/** Id of the workspace's active event (cheap; used to notice a switch made on
 *  another device between full refetches). */
export async function fetchActiveEventId(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** Returns null when the order no longer exists. */
export async function fetchOrderWithItems(
  supabase: SupabaseClient,
  workspaceId: string,
  orderId: string,
): Promise<Order | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data ? toOrder(data as DbOrderWithItems) : null;
}

// ---------- Workspace setup ----------
//
// RLS is disabled on these tables (see supabase/migration-disable-rls.sql).
// The workspace code is the only privacy mechanism; app code always filters
// by workspace_id. Pairing is just a lookup or insert.

export async function joinWorkspace(
  supabase: SupabaseClient,
  code: string,
): Promise<{ id: string; code: string }> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, code")
    .eq("code", code)
    .single();
  if (error) throw new Error(`could not find workspace "${code}"`);
  return { id: (data as DbWorkspace).id, code: (data as DbWorkspace).code };
}

export async function createWorkspace(
  supabase: SupabaseClient,
  code: string,
): Promise<{ id: string; code: string }> {
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ code })
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error(`workspace code "${code}" already taken — try another or join with it`);
    }
    throw error;
  }
  return { id: (data as DbWorkspace).id, code: (data as DbWorkspace).code };
}

// ---------- Realtime subscriptions ----------

export type RealtimeHandlers = {
  onIngredient: (kind: "INSERT" | "UPDATE" | "DELETE", row: DbIngredient | { id: string }) => void;
  onMenuItem:   (kind: "INSERT" | "UPDATE" | "DELETE", row: DbMenuItem   | { id: string }) => void;
  onEvent:      (kind: "INSERT" | "UPDATE" | "DELETE", row: DbEvent      | { id: string }) => void;
  onOrder:      (kind: "INSERT" | "UPDATE" | "DELETE", row: DbOrder      | { id: string }) => void;
  onOrderItem:  (kind: "INSERT" | "UPDATE" | "DELETE", row: DbOrderItem  | { id: string }) => void;
  onInventory:  (kind: "INSERT" | "UPDATE" | "DELETE", row: DbInventoryPurchase | { id: string }) => void;
  onEventExtra?: (kind: "INSERT" | "UPDATE" | "DELETE", row: DbEventExtra | { id: string }) => void;
  onWorkspace:  (row: DbWorkspace) => void;
};

export type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export function subscribeAll(
  supabase: SupabaseClient,
  workspaceId: string,
  handlers: RealtimeHandlers,
  onStatus?: (status: ChannelStatus) => void,
  opts: { includeExtras?: boolean } = {},
): () => void {
  const channel = supabase.channel(`workspace:${workspaceId}`);

  const filter = `workspace_id=eq.${workspaceId}`;
  // The workspaces row's PK is the workspace id itself
  const wsFilter = `id=eq.${workspaceId}`;

  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ingredients", filter },
      (p) => handlers.onIngredient(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error supabase types are loose for old_record
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "menu_items", filter },
      (p) => handlers.onMenuItem(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error see above
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "events", filter },
      (p) => handlers.onEvent(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error see above
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter },
      (p) => handlers.onOrder(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error see above
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_items", filter },
      (p) => handlers.onOrderItem(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error see above
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "inventory_purchases", filter },
      (p) => handlers.onInventory(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error see above
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "workspaces", filter: wsFilter },
      (p) => handlers.onWorkspace(p.new as DbWorkspace),
    );
  // Only bind event_extras when the table exists: a binding to a missing
  // table makes the server reject the whole channel.
  if (opts.includeExtras && handlers.onEventExtra) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "event_extras", filter },
      (p) => handlers.onEventExtra?.(
        p.eventType as "INSERT" | "UPDATE" | "DELETE",
        // @ts-expect-error see above
        p.new && Object.keys(p.new).length ? p.new : p.old,
      ),
    );
  }
  channel.subscribe((status) => onStatus?.(status as ChannelStatus));

  return () => {
    supabase.removeChannel(channel);
  };
}

// Re-export converters for store wiring
export {
  fromIngredient,
  fromMenuItem,
  fromEvent,
  fromOrder,
  fromOrderItem,
  fromInventoryPurchase,
  fromEventExtra,
};
