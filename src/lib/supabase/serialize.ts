import type {
  AppState,
  Event,
  Ingredient,
  InventoryPurchase,
  MenuItem,
  MenuSnapshot,
  Order,
  OrderItem,
  Settings,
} from "@/lib/types";

// ---------- DB row shapes ----------

export type DbWorkspace = {
  id: string;
  code: string;
  low_margin_threshold_pct: number;
  barista_ping_enabled: boolean;
  audio_unlocked: boolean;
};

export type DbIngredient = {
  id: string;
  workspace_id: string;
  name: string;
  package_price: number;
  package_amount: number;
  unit: Ingredient["unit"];
  pool: Ingredient["pool"] | null;
  created_at: string;
  updated_at: string;
};

export type DbMenuItem = {
  id: string;
  workspace_id: string;
  name: string;
  category: MenuItem["category"];
  price: number;
  size: MenuItem["size"];
  active: boolean;
  description: string | null;
  ingredient_lines: MenuItem["ingredientLines"];
  default_milk_id: string | null;
  default_cream_id: string | null;
  allowed_milk_ids: string[];
  allowed_cream_ids: string[];
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

export type DbEvent = {
  id: string;
  workspace_id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  target_revenue: number | null;
  donation_pct: number | null;
  is_active: boolean;
  kind: Event["kind"];
  menu_snapshot: MenuSnapshot;
  fixed_costs: Event["fixedCosts"];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DbOrder = {
  id: string;
  workspace_id: string;
  event_id: string;
  order_number: number;
  customer_name: string;
  status: Order["status"];
  payment_status: Order["paymentStatus"];
  payment_method: Order["paymentMethod"] | null;
  comp_reason: Order["compReason"] | null;
  comp_reason_other: string | null;
  notes: string | null;
  submitted_at: string;
  done_at: string | null;
  updated_at: string;
};

export type DbInventoryPurchase = {
  id: string;
  workspace_id: string;
  name: string;
  amount: number;
  date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DbOrderItem = {
  id: string;
  workspace_id: string;
  order_id: string;
  menu_item_id: string;
  menu_item_name_snap: string;
  price_snap: number;
  cost_snap: number;
  quantity: number;
  milk_choice_id: string | null;
  cream_choice_id: string | null;
  sugar_adjustment: OrderItem["sugarAdjustment"] | null;
  ice_adjustment: OrderItem["iceAdjustment"] | null;
  special_requests: string | null;
  status: OrderItem["status"];
};

// ---------- DB → TS ----------

const undef = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

export function fromIngredient(r: DbIngredient): Ingredient {
  return {
    id: r.id,
    name: r.name,
    packagePrice: Number(r.package_price),
    packageAmount: Number(r.package_amount),
    unit: r.unit,
    pool: r.pool ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function fromMenuItem(r: DbMenuItem): MenuItem {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    price: Number(r.price),
    size: r.size,
    active: r.active,
    description: r.description ?? undefined,
    ingredientLines: r.ingredient_lines ?? [],
    defaultMilkId: r.default_milk_id ?? undefined,
    defaultCreamId: r.default_cream_id ?? undefined,
    allowedMilkIds: r.allowed_milk_ids ?? [],
    allowedCreamIds: r.allowed_cream_ids ?? [],
    sortOrder: r.sort_order ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function fromEvent(r: DbEvent): Event {
  return {
    id: r.id,
    name: r.name,
    date: r.date,
    startTime: r.start_time ?? "",
    endTime: r.end_time ?? "",
    targetRevenue: r.target_revenue ?? undefined,
    donationPct: r.donation_pct == null ? undefined : Number(r.donation_pct),
    menuSnapshotId: r.menu_snapshot?.id ?? r.id,
    fixedCosts: r.fixed_costs ?? [],
    isActive: r.is_active,
    kind: r.kind ?? "live",
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function fromOrder(r: DbOrder, items: OrderItem[]): Order {
  return {
    id: r.id,
    eventId: r.event_id,
    orderNumber: r.order_number,
    customerName: r.customer_name,
    items,
    notes: r.notes ?? undefined,
    paymentStatus: r.payment_status,
    paymentMethod: undef(r.payment_method),
    compReason: undef(r.comp_reason),
    compReasonOther: undef(r.comp_reason_other),
    status: r.status,
    submittedAt: r.submitted_at,
    doneAt: undef(r.done_at),
    updatedAt: r.updated_at,
  };
}

export function fromInventoryPurchase(r: DbInventoryPurchase): InventoryPurchase {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toInventoryPurchaseInsert(
  workspaceId: string,
  p: InventoryPurchase,
): Omit<DbInventoryPurchase, "created_at" | "updated_at"> {
  return {
    id: p.id,
    workspace_id: workspaceId,
    name: p.name,
    amount: p.amount,
    date: p.date,
    notes: nul(p.notes),
  };
}

export function toInventoryPurchasePatch(
  patch: Partial<InventoryPurchase>,
): Partial<DbInventoryPurchase> {
  const r: Partial<DbInventoryPurchase> = {};
  if (patch.name !== undefined) r.name = patch.name;
  if (patch.amount !== undefined) r.amount = patch.amount;
  if (patch.date !== undefined) r.date = patch.date;
  if (patch.notes !== undefined) r.notes = nul(patch.notes);
  return r;
}

export function fromOrderItem(r: DbOrderItem): OrderItem {
  return {
    id: r.id,
    orderId: r.order_id,
    menuItemId: r.menu_item_id,
    menuItemNameSnap: r.menu_item_name_snap,
    priceSnap: Number(r.price_snap),
    costSnap: Number(r.cost_snap),
    quantity: r.quantity,
    milkChoiceId: undef(r.milk_choice_id),
    creamChoiceId: undef(r.cream_choice_id),
    sugarAdjustment: undef(r.sugar_adjustment),
    iceAdjustment: undef(r.ice_adjustment),
    specialRequests: undef(r.special_requests),
    status: r.status,
  };
}

export function fromWorkspaceSettings(w: DbWorkspace): Settings {
  return {
    workspaceCode: w.code,
    lowMarginThresholdPct: Number(w.low_margin_threshold_pct),
    baristaPingEnabled: w.barista_ping_enabled,
    audioUnlocked: w.audio_unlocked,
  };
}

// ---------- TS → DB ----------

const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export function toIngredientInsert(workspaceId: string, ing: Ingredient): Omit<DbIngredient, "created_at" | "updated_at"> {
  return {
    id: ing.id,
    workspace_id: workspaceId,
    name: ing.name,
    package_price: ing.packagePrice,
    package_amount: ing.packageAmount,
    unit: ing.unit,
    pool: ing.pool ?? null,
  };
}

export function toIngredientPatch(patch: Partial<Ingredient>): Partial<DbIngredient> {
  const r: Partial<DbIngredient> = {};
  if (patch.name !== undefined) r.name = patch.name;
  if (patch.packagePrice !== undefined) r.package_price = patch.packagePrice;
  if (patch.packageAmount !== undefined) r.package_amount = patch.packageAmount;
  if (patch.unit !== undefined) r.unit = patch.unit;
  if (patch.pool !== undefined) r.pool = patch.pool ?? null;
  return r;
}

export function toMenuItemInsert(workspaceId: string, m: MenuItem): Omit<DbMenuItem, "created_at" | "updated_at"> {
  return {
    id: m.id,
    workspace_id: workspaceId,
    name: m.name,
    category: m.category,
    price: m.price,
    size: m.size,
    active: m.active,
    description: nul(m.description),
    ingredient_lines: m.ingredientLines,
    default_milk_id: nul(m.defaultMilkId),
    default_cream_id: nul(m.defaultCreamId),
    allowed_milk_ids: m.allowedMilkIds,
    allowed_cream_ids: m.allowedCreamIds,
    sort_order: m.sortOrder ?? null,
  };
}

export function toMenuItemPatch(patch: Partial<MenuItem>): Partial<DbMenuItem> {
  const r: Partial<DbMenuItem> = {};
  if (patch.name !== undefined) r.name = patch.name;
  if (patch.category !== undefined) r.category = patch.category;
  if (patch.price !== undefined) r.price = patch.price;
  if (patch.size !== undefined) r.size = patch.size;
  if (patch.active !== undefined) r.active = patch.active;
  if (patch.description !== undefined) r.description = nul(patch.description);
  if (patch.ingredientLines !== undefined) r.ingredient_lines = patch.ingredientLines;
  if (patch.defaultMilkId !== undefined) r.default_milk_id = nul(patch.defaultMilkId);
  if (patch.defaultCreamId !== undefined) r.default_cream_id = nul(patch.defaultCreamId);
  if (patch.allowedMilkIds !== undefined) r.allowed_milk_ids = patch.allowedMilkIds;
  if (patch.allowedCreamIds !== undefined) r.allowed_cream_ids = patch.allowedCreamIds;
  if (patch.sortOrder !== undefined) r.sort_order = patch.sortOrder;
  return r;
}

export function toEventInsert(
  workspaceId: string,
  evt: Event,
  snapshot: MenuSnapshot,
): Omit<DbEvent, "created_at" | "updated_at"> {
  return {
    id: evt.id,
    workspace_id: workspaceId,
    name: evt.name,
    date: evt.date,
    start_time: evt.startTime || null,
    end_time: evt.endTime || null,
    target_revenue: nul(evt.targetRevenue),
    donation_pct: nul(evt.donationPct),
    is_active: evt.isActive,
    kind: evt.kind ?? "live",
    menu_snapshot: snapshot,
    fixed_costs: evt.fixedCosts,
    notes: nul(evt.notes),
  };
}

export function toEventPatch(patch: Partial<Event>): Partial<DbEvent> {
  const r: Partial<DbEvent> = {};
  if (patch.name !== undefined) r.name = patch.name;
  if (patch.date !== undefined) r.date = patch.date;
  if (patch.startTime !== undefined) r.start_time = patch.startTime || null;
  if (patch.endTime !== undefined) r.end_time = patch.endTime || null;
  if (patch.targetRevenue !== undefined) r.target_revenue = nul(patch.targetRevenue);
  if (patch.donationPct !== undefined) r.donation_pct = nul(patch.donationPct);
  if (patch.fixedCosts !== undefined) r.fixed_costs = patch.fixedCosts;
  if (patch.isActive !== undefined) r.is_active = patch.isActive;
  if (patch.notes !== undefined) r.notes = nul(patch.notes);
  return r;
}

export function toOrderInsert(workspaceId: string, o: Order): Omit<DbOrder, "created_at" | "updated_at"> {
  return {
    id: o.id,
    workspace_id: workspaceId,
    event_id: o.eventId,
    order_number: o.orderNumber,
    customer_name: o.customerName,
    status: o.status,
    payment_status: o.paymentStatus,
    payment_method: nul(o.paymentMethod),
    comp_reason: nul(o.compReason),
    comp_reason_other: nul(o.compReasonOther),
    notes: nul(o.notes),
    submitted_at: o.submittedAt,
    done_at: nul(o.doneAt),
  };
}

export function toOrderPatch(patch: Partial<Order>): Partial<DbOrder> {
  const r: Partial<DbOrder> = {};
  if (patch.customerName !== undefined) r.customer_name = patch.customerName;
  if (patch.status !== undefined) r.status = patch.status;
  if (patch.paymentStatus !== undefined) r.payment_status = patch.paymentStatus;
  if (patch.paymentMethod !== undefined) r.payment_method = nul(patch.paymentMethod);
  if (patch.compReason !== undefined) r.comp_reason = nul(patch.compReason);
  if (patch.compReasonOther !== undefined) r.comp_reason_other = nul(patch.compReasonOther);
  if (patch.notes !== undefined) r.notes = nul(patch.notes);
  if (patch.doneAt !== undefined) r.done_at = nul(patch.doneAt);
  return r;
}

export function toOrderItemInsert(
  workspaceId: string,
  oi: OrderItem,
): Omit<DbOrderItem, never> {
  return {
    id: oi.id,
    workspace_id: workspaceId,
    order_id: oi.orderId,
    menu_item_id: oi.menuItemId,
    menu_item_name_snap: oi.menuItemNameSnap,
    price_snap: oi.priceSnap,
    cost_snap: oi.costSnap,
    quantity: oi.quantity,
    milk_choice_id: nul(oi.milkChoiceId),
    cream_choice_id: nul(oi.creamChoiceId),
    sugar_adjustment: nul(oi.sugarAdjustment),
    ice_adjustment: nul(oi.iceAdjustment),
    special_requests: nul(oi.specialRequests),
    status: oi.status,
  };
}

// ---------- Build AppState from DB rows ----------

export function buildAppState(
  workspace: DbWorkspace,
  ingredients: DbIngredient[],
  menuItems: DbMenuItem[],
  events: DbEvent[],
  orders: DbOrder[],
  orderItems: DbOrderItem[],
  inventoryPurchases: DbInventoryPurchase[],
): AppState {
  const tsIngredients = ingredients.map(fromIngredient);
  const tsMenuItems = menuItems.map(fromMenuItem);
  const tsEvents = events.map(fromEvent);
  const snapshots: MenuSnapshot[] = events
    .filter((e) => e.menu_snapshot)
    .map((e) => e.menu_snapshot);

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const oi of orderItems) {
    const arr = itemsByOrder.get(oi.order_id) ?? [];
    arr.push(fromOrderItem(oi));
    itemsByOrder.set(oi.order_id, arr);
  }
  const tsOrders = orders.map((o) => fromOrder(o, itemsByOrder.get(o.id) ?? []));

  return {
    settings: fromWorkspaceSettings(workspace),
    ingredients: tsIngredients,
    menuItems: tsMenuItems,
    menuSnapshots: snapshots,
    events: tsEvents,
    orders: tsOrders,
    inventoryPurchases: inventoryPurchases.map(fromInventoryPurchase),
  };
}
