import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppState } from "@/lib/types";
import {
  buildAppState,
  fromEvent,
  fromIngredient,
  fromInventoryPurchase,
  fromMenuItem,
  fromOrder,
  fromOrderItem,
  type DbEvent,
  type DbIngredient,
  type DbInventoryPurchase,
  type DbMenuItem,
  type DbOrder,
  type DbOrderItem,
  type DbWorkspace,
} from "./serialize";

// ---------- Loading ----------

export async function loadFullState(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AppState> {
  const [
    { data: ws, error: wsErr },
    { data: ings, error: ingErr },
    { data: items, error: miErr },
    { data: events, error: evErr },
    { data: orders, error: ordErr },
    { data: orderItems, error: oiErr },
    { data: invs, error: invErr },
  ] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspaceId).single(),
    supabase.from("ingredients").select("*").eq("workspace_id", workspaceId),
    supabase.from("menu_items").select("*").eq("workspace_id", workspaceId),
    supabase.from("events").select("*").eq("workspace_id", workspaceId),
    supabase.from("orders").select("*").eq("workspace_id", workspaceId),
    supabase.from("order_items").select("*").eq("workspace_id", workspaceId),
    supabase.from("inventory_purchases").select("*").eq("workspace_id", workspaceId),
  ]);

  const err = wsErr || ingErr || miErr || evErr || ordErr || oiErr || invErr;
  if (err) throw err;
  if (!ws) throw new Error("workspace not found");

  return buildAppState(
    ws as DbWorkspace,
    (ings ?? []) as DbIngredient[],
    (items ?? []) as DbMenuItem[],
    (events ?? []) as DbEvent[],
    (orders ?? []) as DbOrder[],
    (orderItems ?? []) as DbOrderItem[],
    (invs ?? []) as DbInventoryPurchase[],
  );
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
  onWorkspace:  (row: DbWorkspace) => void;
};

export function subscribeAll(
  supabase: SupabaseClient,
  workspaceId: string,
  handlers: RealtimeHandlers,
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
    )
    .subscribe();

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
};
