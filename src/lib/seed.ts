import { computeItemCost } from "./calc";
import type {
  AppState,
  Event,
  FixedCost,
  Ingredient,
  MenuItem,
  MenuSnapshot,
  Order,
  OrderItem,
  Settings,
} from "./types";

// Stable IDs so seed data is deterministic across reloads.

const T0 = "2026-04-01T00:00:00.000Z"; // seed creation

const ingredients: Ingredient[] = [
  { id: "ing_milk_whole", name: "Whole milk", packagePrice: 5.49, packageAmount: 3785, unit: "ml", pool: "milk", createdAt: T0, updatedAt: T0 },
  { id: "ing_milk_oat", name: "Oat milk", packagePrice: 6.99, packageAmount: 946, unit: "ml", pool: "milk", createdAt: T0, updatedAt: T0 },
  { id: "ing_milk_lactose", name: "Lactose-free milk", packagePrice: 7.49, packageAmount: 1893, unit: "ml", pool: "milk", createdAt: T0, updatedAt: T0 },
  { id: "ing_milk_almond", name: "Almond milk", packagePrice: 5.99, packageAmount: 1893, unit: "ml", pool: "milk", createdAt: T0, updatedAt: T0 },

  { id: "ing_cream_ube", name: "Ube cream", packagePrice: 12.0, packageAmount: 500, unit: "ml", pool: "cream", createdAt: T0, updatedAt: T0 },
  { id: "ing_cream_sesame", name: "Sesame cream", packagePrice: 11.0, packageAmount: 500, unit: "ml", pool: "cream", createdAt: T0, updatedAt: T0 },
  { id: "ing_cream_banana", name: "Banana cream", packagePrice: 9.0, packageAmount: 500, unit: "ml", pool: "cream", createdAt: T0, updatedAt: T0 },
  { id: "ing_cream_strawberry", name: "Strawberry cream", packagePrice: 9.0, packageAmount: 500, unit: "ml", pool: "cream", createdAt: T0, updatedAt: T0 },
  { id: "ing_cream_plain", name: "Plain cream", packagePrice: 7.0, packageAmount: 500, unit: "ml", pool: "cream", createdAt: T0, updatedAt: T0 },

  { id: "ing_matcha", name: "Matcha powder", packagePrice: 159, packageAmount: 500, unit: "g", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_agave", name: "Agave", packagePrice: 8.99, packageAmount: 660, unit: "ml", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_cup_12", name: "12oz cup", packagePrice: 24.0, packageAmount: 100, unit: "piece", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_cup_16", name: "16oz cup", packagePrice: 28.0, packageAmount: 100, unit: "piece", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_lid", name: "Lid", packagePrice: 12.0, packageAmount: 100, unit: "piece", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_straw", name: "Straw", packagePrice: 6.0, packageAmount: 250, unit: "piece", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_ice", name: "Ice", packagePrice: 4.0, packageAmount: 4000, unit: "g", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_strawberry", name: "Strawberry purée", packagePrice: 7.0, packageAmount: 500, unit: "ml", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_earlgrey", name: "Earl Grey leaves", packagePrice: 18.0, packageAmount: 250, unit: "g", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_hojicha", name: "Hojicha powder", packagePrice: 32.0, packageAmount: 100, unit: "g", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_chocolate", name: "Dubai chocolate spread", packagePrice: 15.0, packageAmount: 500, unit: "g", pool: null, createdAt: T0, updatedAt: T0 },
  { id: "ing_cheesecake", name: "Cheesecake base", packagePrice: 0.8, packageAmount: 1, unit: "piece", pool: null, createdAt: T0, updatedAt: T0 },
];

const ALL_MILKS = ["ing_milk_whole", "ing_milk_oat", "ing_milk_lactose", "ing_milk_almond"];
const ALL_CREAMS = ["ing_cream_ube", "ing_cream_sesame", "ing_cream_banana", "ing_cream_strawberry", "ing_cream_plain"];

const menuItems: MenuItem[] = [
  {
    id: "mi_classic", name: "Classic Matcha", category: "matcha", price: 6.7, size: "16oz", active: true,
    description: "Ceremonial matcha, milk, light agave.",
    ingredientLines: [
      { ingredientId: "ing_matcha", amount: 4.5, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 180, unit: "ml" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 50, unit: "g" },
      { ingredientId: "ing_cup_16", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: [],
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_strawberry", name: "Strawberry Matcha", category: "matcha", price: 6.9, size: "16oz", active: true,
    description: "Strawberry purée, matcha, milk.",
    ingredientLines: [
      { ingredientId: "ing_matcha", amount: 4.5, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 160, unit: "ml" },
      { ingredientId: "ing_strawberry", amount: 20, unit: "ml" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 50, unit: "g" },
      { ingredientId: "ing_cup_16", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: [],
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_earlgrey", name: "Earl Grey Matcha", category: "matcha", price: 6.9, size: "16oz", active: true,
    description: "Earl Grey-infused matcha latte.",
    ingredientLines: [
      { ingredientId: "ing_matcha", amount: 3.5, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 150, unit: "ml" },
      { ingredientId: "ing_earlgrey", amount: 2, unit: "g" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 50, unit: "g" },
      { ingredientId: "ing_cup_16", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: [],
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_ube", name: "Ube Cream Matcha", category: "cream_top", price: 6.9, size: "16oz", active: true,
    description: "Matcha topped with house ube cream.",
    ingredientLines: [
      { ingredientId: "ing_matcha", amount: 4.5, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 160, unit: "ml" },
      { ingredientId: "ing_cream_ube", amount: 30, unit: "ml" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 50, unit: "g" },
      { ingredientId: "ing_cup_16", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    defaultCreamId: "ing_cream_ube",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: ALL_CREAMS,
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_hojicha_latte", name: "Hojicha Latte", category: "hojicha", price: 6.5, size: "12oz", active: true,
    description: "Roasted green tea latte.",
    ingredientLines: [
      { ingredientId: "ing_hojicha", amount: 4, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 180, unit: "ml" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 40, unit: "g" },
      { ingredientId: "ing_cup_12", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: [],
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_hojicha_sesame", name: "Hojicha Sesame Cream", category: "cream_top", price: 6.9, size: "12oz", active: true,
    description: "Hojicha topped with sesame cream.",
    ingredientLines: [
      { ingredientId: "ing_hojicha", amount: 4, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 160, unit: "ml" },
      { ingredientId: "ing_cream_sesame", amount: 30, unit: "ml" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 40, unit: "g" },
      { ingredientId: "ing_cup_12", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    defaultCreamId: "ing_cream_sesame",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: ALL_CREAMS,
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_banana", name: "Banana Cream Matcha", category: "cream_top", price: 6.9, size: "16oz", active: true,
    description: "Matcha topped with banana cream.",
    ingredientLines: [
      { ingredientId: "ing_matcha", amount: 4.5, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 160, unit: "ml" },
      { ingredientId: "ing_cream_banana", amount: 30, unit: "ml" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 50, unit: "g" },
      { ingredientId: "ing_cup_16", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    defaultCreamId: "ing_cream_banana",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: ALL_CREAMS,
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_dubai", name: "Dubai Chocolate Matcha", category: "matcha", price: 7.6, size: "16oz", active: true,
    description: "Matcha with pistachio-knafeh chocolate.",
    ingredientLines: [
      { ingredientId: "ing_matcha", amount: 4.5, unit: "g" },
      { ingredientId: "ing_milk_whole", amount: 160, unit: "ml" },
      { ingredientId: "ing_chocolate", amount: 15, unit: "g" },
      { ingredientId: "ing_agave", amount: 5, unit: "ml" },
      { ingredientId: "ing_ice", amount: 50, unit: "g" },
      { ingredientId: "ing_cup_16", amount: 1, unit: "piece" },
      { ingredientId: "ing_lid", amount: 1, unit: "piece" },
      { ingredientId: "ing_straw", amount: 1, unit: "piece" },
    ],
    defaultMilkId: "ing_milk_whole",
    allowedMilkIds: ALL_MILKS,
    allowedCreamIds: [],
    createdAt: T0, updatedAt: T0,
  },
  {
    id: "mi_cheesecake", name: "Matcha Cheesecake", category: "pastry", price: 8.0, size: "pastry_count", active: true,
    description: "House-made matcha cheesecake slice.",
    ingredientLines: [
      { ingredientId: "ing_cheesecake", amount: 1, unit: "piece" },
    ],
    allowedMilkIds: [],
    allowedCreamIds: [],
    createdAt: T0, updatedAt: T0,
  },
];

// Snapshot for the seed event (clones)
const snapshot: MenuSnapshot = {
  id: "snap_uci_spring",
  menuItems: menuItems.map((m) => ({ ...m, ingredientLines: m.ingredientLines.map((l) => ({ ...l })), allowedMilkIds: [...m.allowedMilkIds], allowedCreamIds: [...m.allowedCreamIds] })),
  ingredients: ingredients.map((i) => ({ ...i })),
  createdAt: T0,
};

const fixedCosts: FixedCost[] = [
  { id: "fc_table", name: "Table fee", amount: 25, allocationMethod: "event_only" },
  { id: "fc_permit", name: "Permit", amount: 40, allocationMethod: "event_only" },
  { id: "fc_transport", name: "Transport", amount: 15, allocationMethod: "event_only" },
];

const event: Event = {
  id: "evt_uci_spring",
  name: "UCI Spring Pop-Up",
  date: "2026-05-18",
  startTime: "11:00",
  endTime: "16:00",
  targetRevenue: 400,
  menuSnapshotId: snapshot.id,
  fixedCosts,
  isActive: true,
  createdAt: T0,
  updatedAt: T0,
};

// Helper to build order timestamps on event day
function ts(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(2026, 4, 18, h, m, 0)); // month is 0-indexed
  return d.toISOString();
}

type OrderSpec = {
  num: number;
  name: string;
  time: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  paymentStatus: "paid" | "unpaid" | "comped";
  paymentMethod?: "cash" | "venmo" | "zelle" | "card" | "other";
  compReason?: "friend" | "sample" | "mistake" | "other";
  notes?: string;
  items: {
    menuItemId: string;
    quantity: number;
    milkChoiceId?: string;
    creamChoiceId?: string;
    sugarAdjustment?: "less" | "normal" | "extra" | "no_agave";
    iceAdjustment?: "light" | "normal" | "extra";
    specialRequests?: string;
  }[];
};

const orderSpecs: OrderSpec[] = [
  { num: 1, name: "Sam", time: "11:08", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_classic", quantity: 1 }] },
  { num: 2, name: "Maya", time: "11:14", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_strawberry", quantity: 1 }, { menuItemId: "mi_hojicha_latte", quantity: 1 }] },
  { num: 3, name: "Alex", time: "11:22", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_classic", quantity: 1, milkChoiceId: "ing_milk_oat" }] },
  { num: 4, name: "Riley", time: "11:28", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_ube", quantity: 1 }] },
  { num: 5, name: "Jordan", time: "11:35", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_cheesecake", quantity: 1 }, { menuItemId: "mi_classic", quantity: 1 }] },
  { num: 6, name: "Devon", time: "11:42", paymentStatus: "paid", paymentMethod: "card", items: [{ menuItemId: "mi_dubai", quantity: 1, milkChoiceId: "ing_milk_oat" }] },
  { num: 7, name: "Casey", time: "11:48", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_hojicha_sesame", quantity: 1 }] },
  { num: 8, name: "Quinn", time: "11:55", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_banana", quantity: 1 }] },
  { num: 9, name: "Mira", time: "12:03", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_classic", quantity: 1, milkChoiceId: "ing_milk_oat" }, { menuItemId: "mi_classic", quantity: 1 }] },
  { num: 10, name: "Nico", time: "12:11", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_earlgrey", quantity: 1, milkChoiceId: "ing_milk_lactose" }] },
  { num: 11, name: "Theo", time: "12:18", paymentStatus: "comped", compReason: "sample", items: [{ menuItemId: "mi_strawberry", quantity: 1 }] },
  { num: 12, name: "Avery", time: "12:24", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_hojicha_latte", quantity: 1, milkChoiceId: "ing_milk_oat" }] },
  { num: 13, name: "Sage", time: "12:31", paymentStatus: "unpaid", notes: "Will Venmo later", items: [{ menuItemId: "mi_classic", quantity: 1 }] },
  { num: 14, name: "Lin", time: "12:38", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_cheesecake", quantity: 1 }] },
  { num: 15, name: "Skyler", time: "12:46", paymentStatus: "paid", paymentMethod: "card", items: [{ menuItemId: "mi_ube", quantity: 1, milkChoiceId: "ing_milk_almond" }] },
  { num: 16, name: "Reed", time: "12:55", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_hojicha_sesame", quantity: 2 }] },
  { num: 17, name: "Rae", time: "13:05", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_dubai", quantity: 1 }] },
  { num: 18, name: "Jamie", time: "13:13", paymentStatus: "comped", compReason: "friend", items: [{ menuItemId: "mi_classic", quantity: 1 }] },
  { num: 19, name: "Drew", time: "13:21", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_banana", quantity: 1, specialRequests: "make it pretty pls" }] },
  { num: 20, name: "Kai", time: "13:30", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_strawberry", quantity: 1, sugarAdjustment: "less" }] },
  { num: 21, name: "Andy", time: "13:42", paymentStatus: "paid", paymentMethod: "card", items: [{ menuItemId: "mi_classic", quantity: 1 }, { menuItemId: "mi_cheesecake", quantity: 1 }] },
  { num: 22, name: "Vienna", time: "13:55", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_hojicha_latte", quantity: 1 }, { menuItemId: "mi_hojicha_sesame", quantity: 1, creamChoiceId: "ing_cream_strawberry" }] },
  { num: 23, name: "Eli", time: "14:08", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_classic", quantity: 2 }] },
  { num: 24, name: "Mo", time: "14:18", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_ube", quantity: 1, creamChoiceId: "ing_cream_sesame" }] },
  { num: 25, name: "Sasha", time: "14:30", paymentStatus: "comped", compReason: "mistake", notes: "Made wrong drink, comped the redo", items: [{ menuItemId: "mi_classic", quantity: 1 }] },
  { num: 26, name: "Park", time: "14:42", paymentStatus: "paid", paymentMethod: "card", items: [{ menuItemId: "mi_earlgrey", quantity: 1 }] },
  { num: 27, name: "Wren", time: "14:55", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_dubai", quantity: 1 }, { menuItemId: "mi_banana", quantity: 1 }] },
  { num: 28, name: "Lou", time: "15:30", status: "in_progress", paymentStatus: "paid", paymentMethod: "venmo", items: [{ menuItemId: "mi_classic", quantity: 1, milkChoiceId: "ing_milk_oat", sugarAdjustment: "less" }] },
  { num: 29, name: "Tomi", time: "15:45", status: "cancelled", paymentStatus: "unpaid", notes: "Customer walked away", items: [{ menuItemId: "mi_strawberry", quantity: 1 }] },
  { num: 30, name: "Aki", time: "15:55", status: "pending", paymentStatus: "paid", paymentMethod: "cash", items: [{ menuItemId: "mi_strawberry", quantity: 1 }] },
];

function buildOrder(spec: OrderSpec): Order {
  const status = spec.status ?? "completed";
  const items: OrderItem[] = spec.items.map((raw, idx) => {
    const mi = snapshot.menuItems.find((m) => m.id === raw.menuItemId);
    const cost = mi ? computeItemCost(mi, snapshot.ingredients, { milkChoiceId: raw.milkChoiceId, creamChoiceId: raw.creamChoiceId }) : 0;
    return {
      id: `oi_${spec.num}_${idx}`,
      orderId: `ord_${spec.num}`,
      menuItemId: raw.menuItemId,
      menuItemNameSnap: mi?.name ?? "Unknown",
      priceSnap: mi?.price ?? 0,
      costSnap: cost,
      quantity: raw.quantity,
      milkChoiceId: raw.milkChoiceId,
      creamChoiceId: raw.creamChoiceId,
      sugarAdjustment: raw.sugarAdjustment,
      iceAdjustment: raw.iceAdjustment,
      specialRequests: raw.specialRequests,
      status: status === "completed" ? "done" : status === "in_progress" ? "in_progress" : status === "cancelled" ? "pending" : "pending",
    };
  });
  return {
    id: `ord_${spec.num}`,
    eventId: event.id,
    orderNumber: spec.num,
    customerName: spec.name,
    items,
    notes: spec.notes,
    paymentStatus: spec.paymentStatus,
    paymentMethod: spec.paymentMethod,
    compReason: spec.compReason,
    status,
    submittedAt: ts(spec.time),
    updatedAt: ts(spec.time),
  };
}

const orders: Order[] = orderSpecs.map(buildOrder);

const settings: Settings = {
  workspaceCode: "DEMO42",
  lowMarginThresholdPct: 30,
  baristaPingEnabled: true,
  audioUnlocked: false,
};

export function initialSeed(): AppState {
  // Deep clone so external callers can't mutate the module-level constants.
  return JSON.parse(
    JSON.stringify({
      settings,
      ingredients,
      menuItems,
      menuSnapshots: [snapshot],
      events: [event],
      orders,
    } satisfies AppState),
  );
}
