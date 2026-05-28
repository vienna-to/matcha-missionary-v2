# SPEC.md — Matcha Pop-Up Operations & Finance App (Finalized)

> Status: implementation-ready. All product decisions captured across 16 interview rounds (May 19 → May 27 2026).
> A new session can build directly from this document.

---

## 1. Product Summary

An internal operations web app for a matcha pop-up business. Two devices (order taker + barista) work on the same live event in real time. The app handles: taking orders, displaying the barista queue, managing menus and ingredients, computing per-event finance (revenue/cost/profit/margin), and exporting a Google-Sheets-friendly CSV.

Optimized for speed and accuracy during a live pop-up, not for marketing or customer-facing flows.

---

## 2. Architecture

| Concern | Decision |
|---|---|
| Framework | **Next.js (App Router) + TypeScript** |
| Styling | **Tailwind CSS + shadcn/ui** |
| Charts | **Recharts** |
| Backend | **Supabase** (Postgres + Realtime) |
| Hosting | **Vercel** |
| Auth | **None.** Workspace code only (see §3) |
| Offline | **Not supported.** Online required. |
| Sync model | Realtime subscriptions; **last-write-wins** on conflicts |

### 2.1 Sync failure handling

If an order submit fails (network/Supabase error):
- Order is **queued locally** on the order taker's device.
- App **retries automatically** in the background.
- The order card shows a yellow **"syncing…"** badge until success.
- If still failing after ~30s, show a banner: *"Connection issue — orders will sync when reconnected."*

### 2.2 Conflict resolution

- **Orders:** last-write-wins (Supabase row `updated_at` wins). LWW also applies to status/edit changes.
- **Menu / finance edits during a live event:** **locked** once the active event has at least one order. Master menu is still editable, but its changes don't affect the locked frozen snapshot.

---

## 3. Workspace & Pairing

- No accounts. Each install belongs to one **workspace**, identified by a permanent **6-character code** (e.g. `MATCHA-7K2` — display format; storage is a single 6-char alphanumeric string excluding ambiguous chars `0/O/1/I`).
- First launch on a fresh device → app **auto-creates a workspace**, seeds sample data, and lands on Live Orders.
- A second device joins by entering the code on the welcome screen.
- Code is displayed in the **header (small)** and **Settings (large, with copy-to-clipboard)**.
- **No recovery mechanism.** If lost and no other device holds the code, the workspace is unrecoverable. User is expected to copy/save it after first launch.

---

## 4. Data Model

```ts
// IDs are uuid strings unless noted.

type Workspace = {
  id: string;
  code: string;              // 6-char, permanent, displayed to user
  createdAt: string;
};

type Event = {
  id: string;
  workspaceId: string;
  name: string;
  date: string;              // ISO date
  startTime?: string;        // ISO datetime, optional
  endTime?: string;          // ISO datetime, optional
  revenueGoal?: number;      // optional target $
  menuSnapshot: MenuSnapshot;  // frozen at event creation; see §6.1
  fixedCosts: FixedCost[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  // No explicit closed/active flag — see §5.
};

type MenuSnapshot = {
  // Frozen copy of menu items + ingredient definitions at event-creation time.
  items: MenuItem[];
  ingredients: Ingredient[];
  milkPool: MilkOrCreamOption[];   // see §7.2
  creamPool: MilkOrCreamOption[];
};

type MenuItem = {
  id: string;
  name: string;
  category: "Matcha" | "Hojicha" | "Cream top" | "Pastry" | "Seasonal" | "Other";
  price: number;             // selling price; all-inclusive (no tax)
  description?: string;
  active: boolean;           // visible in Live Orders if true
  archived: boolean;         // archived items are hidden from Menu Manager UI but remain in past snapshots
  // Cost is derived — no manualCost field.
  ingredientLines: IngredientLine[];
  defaults: ItemDefaults;
};

type IngredientLine = {
  ingredientId: string;
  amount: number;            // in the ingredient's unit (after conversion)
};

type ItemDefaults = {
  // Pre-fills applied when this item is added to a cart line.
  milkOptionId?: string;     // e.g. "Whole milk" — used iff the item consumes milk
  creamOptionId?: string;    // e.g. "Ube" — used iff the item is a cream-top
  sugar?: "less" | "normal" | "extra" | "no_agave";
  ice?: "light" | "normal" | "extra";
};

type Ingredient = {
  id: string;
  name: string;
  packagePrice: number;
  packageAmount: number;
  unit: Unit;                // see §8.2
  // costPerUnit = packagePrice / packageAmount (computed)
};

type MilkOrCreamOption = {
  id: string;
  name: string;
  costPerUnit: number;       // $ / g (or $ / unit consistent with item's ingredientLine amount)
};

type FixedCost = {
  id: string;
  name: string;
  amount: number;
  // Allocation is fixed app-wide: spread evenly across cups sold. See §8.3.
};

type Order = {
  id: string;
  eventId: string;
  orderNumber: number;        // resets to 1 each event
  customerName: string;       // required (see §7.4)
  items: OrderItem[];
  status: "pending" | "in_progress" | "completed" | "cancelled";
  paymentStatus: "paid" | "unpaid" | "comped";
  paymentMethod?: "cash" | "venmo" | "zelle" | "card" | "other";
  compReason?: "friend" | "sample" | "mistake" | "staff" | "other";
  compReasonOther?: string;   // free-text iff compReason === "other"
  notes?: string;
  submittedAt: string;        // ISO datetime, set on first submit
  doneAt?: string;            // set when order marked completed
  updatedAt: string;          // Supabase-maintained, used for LWW
};

type OrderItem = {
  id: string;
  menuItemId: string;
  // Each cart line is a single drink with its own modifiers.
  // Quantity > 1 only when all modifiers are identical (see §7.5).
  quantity: number;
  // Stamped at submit time from MenuSnapshot:
  priceSnapshot: number;
  costSnapshot: number;       // derived cost incl. chosen milk/cream
  milkOptionId?: string;
  creamOptionId?: string;
  sugar?: "less" | "normal" | "extra" | "no_agave";
  ice?: "light" | "normal" | "extra";
  specialRequests?: string;
  status: "pending" | "in_progress" | "done";
};

type Unit =
  | "g" | "oz" | "lb" | "kg"           // mass
  | "ml" | "fl_oz" | "cup" | "l"        // volume
  | "piece" | "bag";                    // count
```

---

## 5. Event Lifecycle

- **Create morning-of.** No future-events list. From Settings or the home header, tap "**New Event**" → name, date (defaults to today), optional start/end time, optional revenue goal → menu auto-copies from the most recent past event (see §6.2).
- The most recently created event is the **Active Event**. There is no explicit "Open/Close" button.
- Once the active event has at least one order, its **menu snapshot and fixed costs lock** (read-only for that event). Master menu remains editable for future events.
- Switching to a new active event = creating a new one. Past events stay accessible in Event Summary for review/export.

---

## 6. Menu Manager

### 6.1 Snapshots (history frozen)

- When an event is created, the current **master menu + ingredients + milk/cream pools** are deep-copied into `event.menuSnapshot`.
- Editing the master menu later **does not** affect past events.
- Past events display their frozen snapshot for review.

### 6.2 Menu reuse

- New event auto-clones the **most recent past event's** menu snapshot as the starting master menu. User can edit before service begins.
- If no past events exist (first run), the sample menu is used.

### 6.3 Menu item rules

- **Block deletion** of any item that appears in past orders. Offer **Archive** instead. Archived items don't appear in Menu Manager's main list, but remain intact in past event snapshots.
- No search/filter UI in v1 — a single scrollable list is enough.
- One size per menu item. If a drink comes in 8oz and 12oz, create two menu items.

### 6.4 Modifier defaults per item

Each item declares **natural defaults** (see `ItemDefaults`):
- *Ube Cream Matcha* defaults to `creamOptionId = "Ube"`.
- *Classic Matcha* defaults to `milkOptionId = "Whole"`.
- Defaults pre-fill cart lines; order taker can override per drink.

### 6.5 No-cost items

If a menu item has no ingredient lines defined, cost = $0 and margin = 100%. **Allowed silently.** No warning, no block.

---

## 7. Live Orders (Order Taker)

### 7.1 Layout

- Grid of menu item cards. Each card: name, category, price, **+** button. Inactive items are hidden; archived items are never shown here.
- Bottom (mobile) / right rail (tablet+) holds the **cart**.
- A persistent **running total** is shown prominently and updates as items are added.

### 7.2 Modifier UI

- **Milk** is the primary modifier — shown as a chip row on every drink line that consumes milk. Globally one milk pool; selecting a non-default milk re-stamps cost via that option's `costPerUnit`.
- **Cream** is the primary modifier for cream-top drinks. Same pattern with the global cream pool.
- **Sugar** and **Ice** are secondary — hidden under a "Customize" expander on each line.
- **Special requests** = free-text note per line.

### 7.3 Cart shape with split modifiers

- Each **cart line = one set of identical drinks** (same item + same modifiers).
- "2 Classic Matcha, one oat one whole" → **two separate cart lines**: `1× Classic (oat)` and `1× Classic (whole)`.
- A quantity stepper on a line only increases drinks with **identical** modifiers.

### 7.4 Order header fields

- **Customer name** — required.
- **Order number** — auto-assigned, **resets to #1 per event**.
- **Payment status** — `paid` (default) / `unpaid` / `comped` (with chip reason: Friend / Sample / Mistake / Staff / Other).
- **Payment method** — `cash` / `venmo` / `zelle` / `card` / `other`.
- **Notes** — free text.

### 7.5 Submit flow

- **Cart → review → single Submit.** No one-tap-submit mode.
- On submit:
  - Order written to Supabase with `submittedAt` set.
  - Each `OrderItem` stamps `priceSnapshot` + `costSnapshot` (cost includes the chosen milk/cream pool option).
  - Order appears in: order history, barista queue, event sales count, event summary.
- If submit fails, see §2.1 (local queue + auto-retry).

### 7.6 Editing & cancelling

- **Long-press** an order card in the history list → inline edit.
- **Cancel** = edit `status` to `cancelled`. There is no separate Cancel button.
- Cancelled orders are **excluded from both revenue and quantity sold**.
- Cancelled orders are **hidden from the Barista Queue** but remain visible in Live Orders history with a "Cancelled" badge.

---

## 8. Finance & Cost Model

### 8.1 Cost derivation

- Cost per item is **derived only** — `manualCost` is not in the data model.
- `costPerDrink = sum( ingredientLine.amount × ingredient.costPerUnit ) + (chosen milk option cost if applicable) + (chosen cream option cost if applicable)`.

### 8.2 Units & conversion

- Three unit categories: **mass** (g, oz, lb, kg), **volume** (ml, fl oz, cup, l), **count** (piece, bag).
- App converts within a category. Cross-category (e.g. g → ml) is rejected with an error message.

### 8.3 Fixed costs

- Examples: table fee, permit, transport.
- Allocation is fixed app-wide: **spread evenly across cups sold** in the event. Per-item profit views show **fully-loaded margin** (ingredient cost + per-cup share of fixed costs).
- Cups, lids, straws, ice are **not** fixed costs — they are per-drink ingredient lines.

### 8.4 Revenue rules

- An order's drinks count toward **quantity sold** as soon as it's submitted (unless cancelled).
- An order's drinks count toward **revenue** only when `paymentStatus === "paid"`.
- `comped` orders count toward quantity, $0 revenue.
- `cancelled` orders are excluded from both.
- **No tax** — prices are all-inclusive.
- **No tips, no processing fees, no refunds** in v1.

### 8.5 Formulas

```
ingredientCostPerItem = (ingredient.packagePrice / ingredient.packageAmount) × ingredientLine.amount
costPerDrink          = Σ ingredientCostPerItem + (milk option cost) + (cream option cost)
profitPerDrink        = price - costPerDrink
profitMargin          = (profitPerDrink / price) × 100
fullyLoadedCost       = costPerDrink + (event.totalFixedCosts / event.totalCupsSold)
fullyLoadedMargin     = ((price - fullyLoadedCost) / price) × 100
eventRevenue          = Σ priceSnapshot over paid order items
eventQuantity         = Σ quantity over non-cancelled order items
eventCost             = Σ costSnapshot over non-cancelled order items + Σ fixedCosts
eventProfit           = eventRevenue - eventCost
eventMargin           = (eventProfit / eventRevenue) × 100   (undefined if revenue = 0)
```

---

## 9. Barista Queue

### 9.1 Layout

- **Oldest pending first.** Pending + In-Progress orders shown as cards in a vertical list.
- **Completed** orders auto-collapse into a section: `Completed today (47)` — expandable.
- **Cancelled** orders **not shown here**.
- Large text, big tap targets, minimal chrome.

### 9.2 Per-drink toggles

- Each drink in an order has its own checkbox.
- The order's `status` derives automatically:
  - All drinks `pending` → `pending`
  - Any drink `in_progress` or `done`, but not all done → `in_progress`
  - All drinks `done` → `completed` (sets `doneAt`)

### 9.3 New-order alerts

- **Ping sound** — short chime on new order.
- **Visual flash** — new card pulses a matcha-green border briefly.
- **Audio gate:** on first load per session, show a one-time `Tap to enable order alerts` banner. Single tap unlocks audio. Without it, the chime is muted (browser autoplay restriction); flash still works.

---

## 10. Event Summary

### 10.1 Header fields

- Event name, date, start/end time, location notes (free text).
- Total orders, cups poured, cups paid (cups poured ≠ cups paid when unpaid orders exist).
- Gross revenue, total cost, total profit, overall margin.
- Revenue-goal progress bar (if goal set).
- Best-selling item, most profitable item.
- Low-margin flag: items with margin < 30% show a warning icon (threshold configurable per event in v1.1; hardcoded 30% in v1).

### 10.2 Charts

Three charts, in order:
1. **Bar — Quantity sold by item.**
2. **Bar — Revenue & profit by item (grouped, two bars per item).**
3. **Line — Orders over time of day** (bucketed by hour from `submittedAt`).

No pie/donut. No payment-method chart in v1.

### 10.3 CSV export

- **One CSV per event**, item-level. Google-Sheets-friendly column names.
- Columns:
  ```
  Event Name, Event Date,
  Item Name, Category, Quantity Sold, Price,
  Revenue, Cost per Item, Total Cost, Profit per Item, Total Profit, Margin %
  ```
- Footer rows: totals + payment-method breakdown + fixed-cost lines.

---

## 11. UI / Visual

- **Style:** subtle matcha — cream/white base, single matcha-green accent for primary buttons and active states. No green-tinted backgrounds.
- **Navigation:** bottom tabs on mobile; **collapsible sidebar** on tablet/desktop. Five tabs: Live Orders / Barista Queue / Menu Manager / Finance / Event Summary.
- **Role gating:** none. Anyone on any device can see any tab. (Each device may remember last-used tab — nice-to-have.)
- **Dark mode:** not in v1.
- **Active-event header banner:** not in v1.
- **Edited badge / edit history:** not in v1 (`updatedAt` still tracked internally for LWW).
- **Tap targets:** ≥44×44 px throughout.

---

## 12. Persistence & Sync Details

- All entities live in Supabase (single Postgres project).
- Each table has `workspace_id` as the first column; RLS filters by workspace code (anonymous Supabase keys, no user JWT).
- Realtime: clients subscribe to changes in their workspace's `orders`, `events`, and `menu_items` tables.
- LWW via Postgres `updated_at` triggers on every write.
- Local cache: in-memory Zustand store (or equivalent) hydrated from Supabase on app open; written through Supabase on every mutation; reconciled via realtime subscription.

---

## 13. Sample Data

### 13.1 Seed

Auto-loaded on first workspace creation:

- **Event:** UCI Spring Pop-Up — date 2026-05-18 — 30 sample orders, mix of paid/unpaid/comped, mix of milk swaps, mix of cream choices.
- **Menu items** (one size each):
  - Classic Matcha — $6.70
  - Strawberry Matcha — $6.90
  - Ube Cream Matcha — $6.90 (default cream: Ube)
  - Hojicha Sesame Cream — $6.90 (default cream: Sesame)
  - Dubai Chocolate Matcha — $7.60
  - Matcha Cheesecake — $8.00
- **Ingredients:** matcha powder, agave, cup, ice, cream-top base, sesame powder, strawberry purée. With package prices and per-drink amounts per the original SPEC.
- **Milk pool seed:** Whole / Oat / Lactose-free / Almond. (User edits later — these are reasonable defaults.)
- **Cream pool seed:** Ube / Sesame / Banana / Strawberry / Plain. (User edits later.)
- **Fixed costs (sample event):** Table Fee $50, Transport $15.

### 13.2 Reset

- Settings → **Clear all sample data** → wipes the sample event + its orders.
- After clearing, the same Settings card shows a **Reload sample data** button. Idempotent.
- User-created data (real events) is never touched by these buttons.

---

## 14. Edge Cases

| Case | Behavior |
|---|---|
| `price = 0` on a menu item | Allowed (e.g. promo). Reports show 0% margin. |
| Comped item | Counts in quantity, $0 in revenue, full cost charged. |
| Unpaid item | Counts in quantity, $0 in revenue until marked paid. |
| Cancelled order | Excluded from revenue + quantity. Visible only in Live Orders history. |
| No ingredients on item | Cost = 0, margin = 100%. Allowed silently. |
| Cross-category unit (g ↔ ml) | Conversion rejected with error message in Ingredient Manager. |
| Two devices edit same order simultaneously | Last write wins (Supabase `updated_at`). |
| Menu edit while event has orders | Blocked for that event; master menu still editable. |
| Submit fails (network) | Local queue + auto-retry + yellow "syncing" badge. |
| Workspace code lost, no paired device | Data is unrecoverable. User must save the code. |

---

## 15. Out of Scope for v1

Confirmed deferred (no items moved into scope):
- Inventory tracking
- Customer-facing ordering site
- Online payments
- Receipt printing / PDF receipts
- Tax tracking & reporting
- Tips, payment-processor fees, refunds
- Staff accounts / role permissions
- Loyalty system
- Break-even calculator / projected profit pre-event
- Comparison view across multiple events
- Dark mode

---

## 16. Acceptance Criteria

The build is shippable when:

- [ ] First-launch on a fresh device auto-creates a workspace and lands in the sample event.
- [ ] A second device can join via workspace code and see realtime order updates.
- [ ] Order taker can complete the full cart → review → submit flow with name + payment status + at least one modifier in under 10 seconds.
- [ ] Barista queue updates within ~1s of order submission, oldest-first, with audio + flash alert.
- [ ] Per-drink toggles correctly derive order status.
- [ ] Long-press → edit → set status to Cancelled removes the order from revenue and quantity.
- [ ] Menu Manager blocks deletion of items used in past orders; Archive works instead.
- [ ] Past events display their frozen menu snapshot regardless of current master-menu edits.
- [ ] Finance shows derived costs that update when milk/cream pool prices change (for the master menu, not frozen snapshots).
- [ ] Event Summary renders all three charts, hits the revenue-goal progress bar, and flags low-margin items.
- [ ] CSV export opens cleanly in Google Sheets with totals.
- [ ] Clear sample data → Reload sample data round-trips correctly.
- [ ] Submit-while-offline queues the order with a "syncing" badge and reconciles on reconnect.

---

## Appendix A — Decision Log

A complete record of the 16 interview rounds is preserved in the transcript files (`transcript-2026-05-20-qa.txt` etc.). Key cross-cutting decisions:

| Topic | Decision |
|---|---|
| Stack | Next.js + TS + Tailwind + shadcn + Recharts + Supabase + Vercel |
| Auth | None — workspace code only |
| Offline | Not supported |
| Event lifecycle | Create morning-of; no formal close; lock menu/finance when event has orders |
| Cart shape | Separate line per modifier combo |
| Sizes | One size per menu item |
| Modifier pricing | Free (no upcharges); modifiers may change *cost* via milk/cream pools |
| Revenue rule | Paid only |
| Quantity rule | All submitted, non-cancelled (counts cup poured even if unpaid) |
| Comp reasons | Friend / Sample / Mistake / Staff / Other |
| Tax/tips/fees/refunds | None in v1 |
| Cost model | Derived from ingredients + chosen pool option; no manual override |
| Fixed cost allocation | Spread evenly across cups sold |
| Per-drink ingredients | Cups, lids, straws, ice are per-drink (not fixed) |
| Barista sort | Oldest pending first; completed collapses; cancelled hidden |
| Per-drink toggles | Yes; order status derived |
| Edits | Inline (long-press); no separate void button; no edit history UI |
| Charts | Bar (qty), Bar (rev+profit grouped), Line (time-of-day) |
| Export | One item-level CSV per event |
| Pairing | 6-char permanent workspace code; show in header + Settings; no recovery |
| First launch | Auto-create workspace + sample event |
| Sync | Realtime; LWW; queue+retry on failure |
| Audio | One-time "Enable sound" prompt per session |
| Sample data | UCI Spring Pop-Up seed; clearable + reloadable |
