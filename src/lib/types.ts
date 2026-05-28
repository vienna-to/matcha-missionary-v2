// Data model — see SPEC.md §16

export type Category =
  | "matcha"
  | "hojicha"
  | "cream_top"
  | "pastry"
  | "seasonal"
  | "other";

export const CATEGORIES: Category[] = [
  "matcha",
  "hojicha",
  "cream_top",
  "pastry",
  "seasonal",
  "other",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  matcha: "Matcha",
  hojicha: "Hojicha",
  cream_top: "Cream Top",
  pastry: "Pastry",
  seasonal: "Seasonal",
  other: "Other",
};

export type Unit =
  | "g"
  | "oz"
  | "kg"
  | "lb"
  | "ml"
  | "fl_oz"
  | "cup"
  | "piece"
  | "bag";

export const UNITS: Unit[] = [
  "g",
  "oz",
  "kg",
  "lb",
  "ml",
  "fl_oz",
  "cup",
  "piece",
  "bag",
];

export type Size = "8oz" | "10oz" | "12oz" | "16oz" | "pastry_count" | "other";

export const SIZES: Size[] = ["8oz", "10oz", "12oz", "16oz", "pastry_count", "other"];

export const SIZE_LABELS: Record<Size, string> = {
  "8oz": "8 oz",
  "10oz": "10 oz",
  "12oz": "12 oz",
  "16oz": "16 oz",
  pastry_count: "Pastry",
  other: "Other",
};

export type Pool = "milk" | "cream" | null;

export type IngredientLine = {
  ingredientId: string;
  amount: number;
  unit: Unit;
};

export type Ingredient = {
  id: string;
  name: string;
  packagePrice: number;
  packageAmount: number;
  unit: Unit;
  pool?: Pool;
  createdAt: string;
  updatedAt: string;
};

export type MenuItem = {
  id: string;
  name: string;
  category: Category;
  price: number;
  size: Size;
  active: boolean;
  description?: string;
  ingredientLines: IngredientLine[];
  defaultMilkId?: string;
  defaultCreamId?: string;
  allowedMilkIds: string[];
  allowedCreamIds: string[];
  /** Ascending sort key — controls display order in menu/order/finance views.
   *  Missing values are treated as Infinity (sort last). */
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
};

/** Stable comparator: sortOrder ASC, then name. */
export function compareMenuItems(a: MenuItem, b: MenuItem): number {
  const sa = a.sortOrder ?? Number.POSITIVE_INFINITY;
  const sb = b.sortOrder ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return a.name.localeCompare(b.name);
}

export type MenuSnapshot = {
  id: string;
  menuItems: MenuItem[];
  ingredients: Ingredient[];
  createdAt: string;
};

export type FixedCost = {
  id: string;
  name: string;
  amount: number;
  // Per finalized SPEC §8.3: fixed costs spread evenly across cups sold.
  // "event_only" kept as an alias for historical seeds — both interpreted as spread_evenly.
  allocationMethod: "spread_evenly" | "event_only";
};

/**
 * "live"  = a real event with full order tracking — every metric available.
 * "past"  = a quick-entered retroactive event; per-order data is synthetic
 *           so payment-mix and time-of-day charts are suppressed.
 *
 * Optional: rows without a value (legacy localStorage data, fresh DB inserts
 * before the migration) are treated as "live".
 */
export type EventKind = "live" | "past";

export type Event = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  targetRevenue?: number;
  menuSnapshotId: string;
  fixedCosts: FixedCost[];
  isActive: boolean;
  kind?: EventKind;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type OrderItemStatus = "pending" | "in_progress" | "done";
// The literal value remains "comped" for DB compatibility; UI calls it "free".
export type PaymentStatus = "paid" | "unpaid" | "comped";
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "paid",
  unpaid: "unpaid",
  comped: "free",
};
export type PaymentMethod = "cash" | "venmo" | "zelle" | "card" | "other";
export type CompReason = "friend" | "sample" | "mistake" | "staff" | "other";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "venmo",
  "zelle",
  "card",
  "other",
];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  venmo: "Venmo",
  zelle: "Zelle",
  card: "Card",
  other: "Other",
};

export const COMP_REASONS: CompReason[] = ["friend", "sample", "mistake", "staff", "other"];
export const COMP_REASON_LABELS: Record<CompReason, string> = {
  friend: "Friend",
  sample: "Sample",
  mistake: "Mistake",
  staff: "Staff",
  other: "Other",
};

export type SugarAdjustment = "less" | "normal" | "extra" | "no_agave";
export type IceAdjustment = "light" | "normal" | "extra";

export type OrderItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemNameSnap: string;
  priceSnap: number;
  costSnap: number;
  quantity: number;
  milkChoiceId?: string;
  creamChoiceId?: string;
  sugarAdjustment?: SugarAdjustment;
  iceAdjustment?: IceAdjustment;
  specialRequests?: string;
  status: OrderItemStatus;
};

export type Order = {
  id: string;
  eventId: string;
  orderNumber: number;
  customerName: string;
  items: OrderItem[];
  notes?: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  compReason?: CompReason;
  compReasonOther?: string;
  status: OrderStatus;
  submittedAt: string;
  doneAt?: string;
  updatedAt: string;
};

export type Settings = {
  workspaceCode: string;
  lowMarginThresholdPct: number; // e.g. 30 means below 30% margin warn
  baristaPingEnabled: boolean;
  audioUnlocked: boolean; // session-flag style; persists once user taps "Enable sound"
};

export type AppState = {
  settings: Settings;
  ingredients: Ingredient[]; // master
  menuItems: MenuItem[]; // master
  menuSnapshots: MenuSnapshot[];
  events: Event[];
  orders: Order[];
};
