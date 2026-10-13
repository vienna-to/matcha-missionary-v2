import type { Ingredient, MenuItem, MenuSnapshot, Order, OrderItem } from "@/lib/types";

const T = "2026-01-01T00:00:00.000Z";

export const WHOLE: Ingredient = {
  id: "ing-whole",
  name: "Whole milk",
  packagePrice: 4,
  packageAmount: 128,
  unit: "fl_oz",
  pool: "milk",
  createdAt: T,
  updatedAt: T,
};

export const MATCHA_LATTE: MenuItem = {
  id: "mi-latte",
  name: "Matcha Latte",
  category: "other" as MenuItem["category"],
  price: 7,
  size: "12oz",
  active: true,
  ingredientLines: [],
  defaultMilkId: WHOLE.id,
  allowedMilkIds: [],
  allowedCreamIds: [],
  createdAt: T,
  updatedAt: T,
};

export const SNAPSHOT: MenuSnapshot = {
  id: "snap-1",
  menuItems: [MATCHA_LATTE],
  ingredients: [WHOLE],
  createdAt: T,
};

export function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "oi-1",
    orderId: "ord-1",
    menuItemId: MATCHA_LATTE.id,
    menuItemNameSnap: "Matcha Latte",
    priceSnap: 7,
    costSnap: 2,
    quantity: 1,
    status: "pending",
    ...over,
  };
}

export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    eventId: "evt-1",
    orderNumber: 1,
    customerName: "Sam",
    items: [makeItem()],
    submittedAt: T,
    updatedAt: T,
    paymentStatus: "paid",
    paymentMethod: "cash",
    status: "pending",
    ...over,
  };
}
