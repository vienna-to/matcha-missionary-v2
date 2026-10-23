# QA report: Matcha Missionary pop-up ops/finance app

Branch: `qa/e2e-test-pass` (4 commits on top of `c6ec61c`; not pushed).
Run: `npx playwright test` (32 tests: 31 pass, 1 is an expected failure that documents BUG-QA-6) plus `npx vitest run` (80 pass, 3 new).

## Verdict

**Yes, with one caveat: the app does what a pop-up needs on the paths that could be tested, but I could only test it against the built-in local-storage adapter, not against Supabase.**
Orders, payment-method totals, revenue, ingredient cost, margin, contract payout math, helper mode, the barista queue and the combo deal all matched hand-calculated values. Two real money bugs (Edit Order re-pricing sold lines, and dropping items added mid-event) were found and are fixed on this branch. One workflow gap (cannot re-activate an event) is left for you.

**Not tested: anything that needs Supabase** (`submit_order` RPC, workspace pairing and the `?workspace=CODE` auto-join, realtime sync between devices, retry/offline behaviour). This machine has no Docker, so `supabase start` was impossible, and `.env.local` points at your production project, so I refused to use it. See "Isolation" below. Install Docker Desktop and I can run the same suite against a local Supabase.

## Isolation: production was never touched

- `.env.local` points at the hosted project (`ycctyfibtbrtwhoqqyfm`). It was only read to find that out (the key was never printed) and is unchanged.
- `playwright.config.ts` / `e2e/serve.mjs` build and serve the app with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` forced to empty strings (they are inlined at build time, so the build is also made blank). The app then uses its localStorage adapter.
- Proof, enforced on every run: `e2e/00-isolation.spec.ts` greps the whole `.next` bundle for the production project id (none found), and every test has an automatic network guard that aborts and fails on any request to `supabase.co` / the production id. Zero such requests occurred in all 32 tests. DB target printed by the run: "local-storage adapter (no database host)".
- No migration, SQL, Supabase CLI or Vercel command was run.

## What was tested

| # | Area | Result | Severity if not pass |
|---|---|---|---|
| 1 | Production bundle contains no prod project id | pass | |
| 2 | App boots on local adapter, 0 Supabase requests | pass | |
| 3 | Happy path: new event, 5 orders (2 items on one, 2 pastries), Zelle/Venmo/Cash/Other, barista claim, item flow, complete, reopen | pass | |
| 4 | Finance vs hand calc: revenue $56.40, Zelle 13.40 / Venmo 13.40 / Cash 22.70 / Other 6.90, cost $14.84, profit $41.56, margin 73.7%, cups 6, pastries 2, items sold 8 | pass | |
| 5 | New-event validation: zero cup size, empty contract client/payout block Create | pass | |
| 6 | Event end time before start time | accepted (see QA-3) | minor |
| 7 | Order needs an item and a payment method | pass | |
| 8 | Order with blank customer name saves and can still be edited | pass | |
| 9 | Quantity floor of 1; 60 x $6.70 = $402.00 saved correctly | pass | |
| 10 | 8 rapid orders get numbers 1..8 | pass | |
| 11 | Edit quantity self-corrects totals; delete drops revenue | pass | |
| 12 | Delete renumbers later orders | by design (QA-4) | minor risk |
| 13 | Menu price change applies to new orders only; placed orders keep priceSnap | pass | |
| 14 | Ingredient price change applies to new orders only; placed orders keep costSnap | pass | |
| 15 | Edit Order after a price change keeps the sold price | **was failing, fixed** (QA-1) | major |
| 16 | Item added after the event was created survives an order edit | **was failing, fixed** (QA-1b) | major |
| 17 | Archived (unavailable) item leaves Live Orders and combo picker; old sales and reporting keep it | pass | |
| 18 | Contract event: payout $500, 10 Classic + 4 Cheesecake: cost $25.54, margin $474.46, per drink $47.45, per item $33.89; no standard-event revenue fields leak in | pass | |
| 19 | All-events view adds contract payout ($757.10 revenue, $586.49 profit) | pass | |
| 20 | Helper link: restricted tabs, param stripped, survives reload, `?helper=0` cannot disable, discount button hidden | pass | |
| 21 | Exiting helper mode needs the workspace code | pass | |
| 22 | Fresh helper-link join in a new browser context | partial: local mode has no workspace to join (QA-10) | n/a |
| 23 | Two devices submit at the same moment: both orders kept, unique numbers | pass (local adapter only) | |
| 24 | Barista on a second device sees new order live; claim shows on both | pass (local adapter only) | |
| 25 | Reload keeps events and orders; unsent cart is lost | works as coded (QA-8) | minor |
| 26 | Browser Back leaves the app | works as coded (QA-8) | minor |
| 27 | Re-activate a previous event | **fail, left open** (QA-6) | major |
| 28 | New event with zero orders: no NaN / Infinity / undefined on any screen | pass | |
| 29 | Delete the active event: clean "No active event" state, orders cascade-deleted | pass | |
| 30 | Event CSV export contains items and revenue | pass | |
| 31 | Combo: drink + pastry offers a combo; accepting prices the pair at $10 with summed cost | pass | |
| 32 | Phone (390px): create event, take an order through the bottom sheet, barista sees it, no horizontal overflow | pass | |

Two of my own first-draft expectations were arithmetic slips in the test, not app bugs (items sold is 8, cups poured is 6). One suspected bug (QA-2, blank-name orders cannot be edited) was wrong: blank names get a default name, so editing works.

## Bugs

### QA-1 (major, FIXED): Edit Order silently re-prices every line
- **Repro:** raise Classic Matcha to $8 in Menu Manager, ring up a Classic ($8), open the order from the Barista Queue, change only the note, Save. The line becomes $6.70 again.
- **Root cause:** `src/lib/reducer.ts` `REPLACE_ORDER_ITEMS` (about line 491) called `deriveOrderItem` against the event's frozen snapshot for every line, overwriting `priceSnap`, `listPrice`, `costSnap` and the name stamped at sale time. Live Orders sells from the master menu, so the two disagreed. Any edit, even a name or note change, rewrote revenue and cost history.
- **Fix:** `EditOrderModal` now sends `sourceItemId` for existing lines; the reducer keeps the stamped price, cost and name when the product and cost-affecting choices (combo pastry, milk, cream) are unchanged. Quantity, discount, notes and status changes no longer re-price. Changing the milk re-costs that line from the current menu.
- **Tests:** `e2e/30-menu-pricing.spec.ts` and `src/lib/__tests__/replace-order-items.test.ts` (both fail without the fix, verified).

### QA-1b (major, FIXED): item added after the event was created turns into "$0 Unknown item" on edit
- **Repro:** create an event, add a menu item "Pop Special" $5, sell it, open the order in Edit, Save. The line becomes `Unknown item` at $0, and with only that item the order flips to "free".
- **Root cause:** same code path: the item is not in the event snapshot, so `deriveOrderItem` found nothing. Edit Order also hid such lines (`DraftItemRow` returns null when the item is missing) and totalled them as $0.
- **Fix:** the reducer and `EditOrderModal` fall back to the master menu for items missing from the snapshot, and the modal totals existing lines at their stamped price.

### QA-6 (major, LEFT OPEN): no way to make an older event active again
- **Repro:** create "First", then "Second". "First" is now inactive and nothing in the UI re-activates it. Same after deleting the active event: Live Orders shows "No active event" until you create another.
- **Root cause:** `SET_ACTIVE_EVENT` exists in the reducer, store and `writer.setActiveEvent`, but no component dispatches it (`grep SET_ACTIVE_EVENT src --include=*.tsx` finds nothing). A mistaken double-create or an event that runs over two days cannot be resumed.
- **Recommended fix:** a "Make active" button in the Event Summary header for inactive events (hidden in helper mode, which already hides that tab). Left alone because it adds UI you may want to place yourself. `e2e/40-contract-helper-misc.spec.ts` has an expected-fail test for it; remove `test.fail` once it exists.

### QA-3 (minor, left open): end time before start time is accepted
`NewEventDialog.tsx` never compares the two. Not changed because an overnight event (22:00 to 02:00) is plausible and the model has no end date. Recommend a warning rather than a block.

### QA-4 (minor risk, by design): deleting an order renumbers the later ones
`reducer.ts` `renumberEventOrders` closes the gap on purpose (comment says so). Risk: a customer holding ticket #4 now sees #3 on the queue. Consider keeping numbers stable and letting reports tolerate gaps.

### QA-5 (cosmetic): copy contradicts behaviour
`NewEventDialog` and Settings say edits to the master menu after creating an event "won't affect this event". Live Orders deliberately sells from the master menu (comment in `LiveOrders.tsx`), so a price change mid-event does apply to new orders. Already-placed orders are safe (tests 13, 14). Suggest rewording to "orders already placed keep their prices".

### QA-7 (informational): the order audit trail exists only with Supabase
`store.tsx` appends `orderRevisions` only when the Supabase writer exists, so local mode records no edit/delete history. Could not be checked against the real tax export.

### QA-8 (minor): session behaviour
An unsent cart and the selected tab are React state only, so a reload mid-order loses the cart and returns to Live Orders. There is one URL and no history entries, so the browser Back button leaves the app. Submitted orders and events persist.

### QA-9 (cosmetic, accessibility)
`Modal` has no `role="dialog"` / `aria-modal`, and `Field` renders its label without `htmlFor`, so labels are not tied to inputs (screen readers and `getByLabel` cannot see them). Escape-to-close was not tested.

### QA-10 (limitation of this run)
The helper link's `?workspace=CODE` auto-join, cross-device sync and `submit_order` atomicity could not be exercised. The local adapter shares state only between tabs of one browser profile.

## Things the app does not do (not bugs)
- No sales tax is calculated anywhere in the app. Items carry a `taxable` flag and events carry city/admission for the CSV and quarterly report only.
- No stock counts: "unavailable" means archived in Menu Manager.
- Claiming an order is a status flag, not a lock. Any barista can still mark it done (UI hint only).

## Fixed on the branch vs left to you
- **Fixed (commit `a9ee96a`):** QA-1, QA-1b. Files: `src/lib/reducer.ts`, `src/components/EditOrderModal.tsx`, new `src/lib/__tests__/replace-order-items.test.ts`.
- **Left to you:** QA-6 (needs a UI decision), QA-3, QA-4, QA-5, QA-9, and running the suite against local Supabase.

## Commits
1. `d91e984` test harness (Playwright, isolation spec, helpers)
2. `b9b9751` e2e specs (bugs marked `test.fail`)
3. `a9ee96a` the QA-1 / QA-1b fix plus tests (kept separate from test setup, as asked)
4. this report

## Running it
`npx playwright test` builds once with blank Supabase env and serves on port 3101. `E2E_REBUILD=1 npx playwright test` after changing app code. Needs system Google Chrome (no browser download).


---

# Follow-up pass (FIXES.md)

Same branch, one commit per fix, nothing pushed or deployed. Final state: `npx playwright test` **37 passed, 0 expected-fails**; `npx vitest run` **90 passed** (80 before, +10); typecheck, lint and `next build` pass.

| # | Item | Result | Verified in |
|---|---|---|---|
| 1 | Do the a9ee96a fixes cover Supabase mode? | **Yes, no second code path** | Supabase path by unit test against the real writer with a recording fake client; local by e2e |
| 2 | "Make active" button | Done | Local e2e; Supabase path by code reading (see below) |
| 3 | Event time validation | Done (all submit paths) | Unit + local e2e; Supabase mirror guarded |
| 4 | Stable order numbers | Done | Unit + local e2e; Supabase by code reading |
| 5 | Menu-edit copy | Done | Local e2e |
| 6 | Accessibility markup | Done, low risk | Local e2e |
| 7 | Untested Supabase paths | **Partly done, see "Local Supabase pass" below** (Docker was installed afterwards) | Live local DB for pairing, helper link, order submission, item 1, audit trail; **Make active and realtime still unverified** |

## 1. Supabase edit path (verified, no change needed beyond a9ee96a)
In `store.tsx` the Supabase `dispatch` applies the same reducer locally (`baseDispatch(a)`), then for `REPLACE_ORDER_ITEMS` reads the resulting order back from state and calls `writer.replaceOrderItems(orderId, order.items)` (delete + insert). There is no separate Supabase edit logic, so the reducer fix is what reaches the database. `order_items.menu_item_id` is plain text (no foreign key to the snapshot), so mid-event items insert fine, and the `tg_order_items_prices` trigger derives `price_charged` from the kept `price_snap`.
New `src/lib/__tests__/supabase-edit-path.test.ts` runs reducer then the real `writer.replaceOrderItems` against a recording fake client and checks the inserted rows: a price change after the event leaves `price_snap`/`list_price`/`price_charged`/`cost_snap` at their sale-time values, and an item added after the event is written with its real name and price, not `Unknown item` / 0.
Not covered: a live database round trip (needs local Supabase, item 7).

## 2. Make active
`EventSummary.tsx` standard-event header shows a **Make active** button when the selected event is not active (also works after deleting the active event). It dispatches the existing `SET_ACTIVE_EVENT`. Supabase: the store already mirrors it with `writer.setActiveEvent`, and `schema.sql` has the `tg_events_single_active` trigger that deactivates the others, so other devices follow via the normal realtime event updates. Contract events do not take orders, so they get no button (a contract event created later still deactivates the live one; use the button on the standard event to go back). Tests: resume after creating a second event, resume after deleting the active one.

## 3. Event times
New `src/lib/event-times.ts` (`validateEventTimes`): end must be after start (equal is rejected). Enforced in: New event dialog (inline red message plus disabled Create), Log past event dialog, `buildQuickAddEvent` (throws, shown by the dialog's existing error handling), reducer `CREATE_EVENT` and `UPDATE_EVENT` (ignored if invalid), and the Supabase mirror in `store.tsx` (skips the write so a rejected create cannot re-write the previous event). Overnight events are no longer possible; that was your call.

## 4. Stable order numbers
`DELETE_ORDER` now only removes the order. The reducer's renumbering and the Supabase mirror's per-order `updateOrder(orderNumber)` writes are removed (dead `renumberAfterDelete` deleted). New orders use highest number + 1 locally and `max(order_number) + 1` in `submit_order`, so deleting the highest-numbered order frees that number for the next order. Say if you would rather never reuse numbers; that needs a per-event counter column in Supabase.

## 5. Copy
New event dialog, Menu Manager header and Settings now say orders use the current menu, changes apply to orders taken afterwards, and placed orders keep the price and cost they were sold at (contract events: results use the menu saved at creation).

## 6. Accessibility
`ui.tsx`: `Modal` and `Sheet` get `role="dialog"`, `aria-modal`, and an accessible name (title / "Current order"); `Field` ties its label to Input, NumberField, TextField, Textarea and Select via `htmlFor`/`id` (never overrides an existing id, leaves other children alone). No layout or behaviour change. Not done on purpose: Escape-to-close and focus trapping, because nested modals (Edit Order inside Customize Item) could close together; recommend as a separate change.

## 7. Supabase paths: not done
Docker is not installed on this machine (`docker`, `podman`, Docker Desktop all absent), so no local Supabase. Still untested: `submit_order` RPC and retry, workspace pairing, helper-link `?workspace=` auto-join, realtime sync between devices, and the edit/delete audit trail (`order_revisions`). Install Docker Desktop and run `supabase start`, apply `supabase/schema.sql` then the `migration-*.sql` files in the order listed in earlier notes, and I can run the suite against it.

## Left undone / notes
- Item 7 above (superseded in part by the Local Supabase pass below).
- Escape/focus handling for dialogs (see 6).
- Order numbers can be reused after deleting the newest order (see 4).
- Commits since the first report: `Test: Supabase-mode edit path`, `Make active`, `Reject events whose end time...`, `Deleting an order no longer renumbers`, `Menu-edit copy`, `Accessibility`, plus this report.

# Local Supabase pass

Docker Desktop was installed afterwards, so the Supabase paths were run against a **local** Supabase (`supabase start`: API `http://127.0.0.1:54321`, database `127.0.0.1:54322`, containers `supabase_*_sbwork`). `schema.sql` and all 20 `migration-*.sql` files applied cleanly, in git-history order. The production project `ycctyfibtbrtwhoqqyfm` and the production deployment were never contacted: the server script (`e2e/serve-supabase.mjs`) refuses any URL that is not localhost, and the browser guard in `e2e/supabase/sb.ts` aborts and fails a test on any request to a hosted Supabase host. Nothing pushed or deployed.

## Results

| Area | Result | Spec |
|---|---|---|
| Isolation (app talks only to `127.0.0.1:54321`) | **Verified** | `10-pairing-order` |
| Workspace pairing: create, remembered on reload, join from a second device, unknown code rejected, duplicate code rejected, bad `?workspace=` link lands on join with an error | **Verified** (6 tests) | `10-pairing-order` |
| Helper link `?workspace=CODE&helper=1`: auto-joins, params stripped, restricted tabs, pairing saved | **Verified** | `10-pairing-order` |
| Order submission through the `submit_order` RPC: order, items, snapshots, numbering 1 then 2 | **Verified** | `10-pairing-order` |
| **Item 1**: edit a placed order after a price change (note-only edit, then quantity edit) keeps `price_snap`/`list_price`/`price_charged`/`cost_snap` at sale-time values | **Verified in the live DB** | `20-edit-pricing-audit` |
| **Item 1**: item added after the event keeps its real name and price through an edit (no "Unknown item", `menu_item_id` resolves to the real menu item) | **Verified in the live DB** | `20-edit-pricing-audit` |
| **Item 1**: two-line order keeps each line's own price and cost after an edit | **Verified in the live DB** | `20-edit-pricing-audit` |
| Audit trail: each edit writes an `order_revisions` pre-image (`replace_items`, `update`); deleting an order removes it and its items and leaves a `delete` revision with the full snapshot | **Verified in the live DB** | `20-edit-pricing-audit` |
| **Item 2: Make active** against the live DB (button re-activates, `tg_events_single_active` leaves exactly one active, behaviour after deleting the active event) | **NOT VERIFIED** | `30-make-active` written, no result |
| **Realtime sync between two clients** (order appears on the other device, status and delete propagate, menu price change propagates) | **NOT VERIFIED** | `40-realtime` written, no result |

Passed: `10-pairing-order` 7 of 7, `20-edit-pricing-audit` 3 of 3. I did not run the unit tests, typecheck, lint or build again after adding the harness, and the existing local-mode suite (`npx playwright test`, 37 tests) was not re-run: it reads state from localStorage, so it cannot run against Supabase mode, which is why the Supabase checks are separate specs.

## Why Make active and realtime are unverified
`30-make-active.spec.ts` and `40-realtime.spec.ts` are committed but have **not produced a pass or a fail**. On this 8 GB machine the run was killed once for low memory, and the later attempts stalled at the first test with no result, while the shell tools were returning empty output. I could not tell a hang from a kill, so I am not claiming the result either way. The code path (`SET_ACTIVE_EVENT` then `writer.setActiveEvent` then the `tg_events_single_active` trigger) is the same one reviewed earlier by reading, but it has still not been run against the database. Until those two specs run, treat item 2 on Supabase and realtime sync as untested.

## Finding: editing an order is not atomic in Supabase
`writer.replaceOrderItems` deletes the order's items and then inserts the new ones as two requests. Between them the order has **no items** in the database; my first test read inside that gap. Another device on realtime could briefly show an edited order with no items, and if the insert fails after the delete the order is left empty (the app reports a save error). Not changed. Suggested fix: one database function (like `submit_order`) that replaces the items in a single transaction.

## Running it yourself
1. `supabase start` in a scratch directory (the repo has no `supabase/config.toml`; the schema is applied with `psql` from `supabase/schema.sql`, then the `migration-*.sql` files in git-history order: disable-rls, add-event-kind, add-menu-sort, remove-card, add-donation-pct, add-inventory, add-combo, discount-priority, add-event-contract, add-inventory-archived, add-event-tax-fields, add-menu-taxable, add-order-revisions, flip-menu-taxable-default, add-ingredient-sort, atomic-order, order-item-prices, order-tips-and-extras, submit-order-v2, free-reason-friend).
2. `E2E_SB_ANON=<the local anon key> npx playwright test -c playwright.supabase.config.ts <spec> --workers=1`. Run one spec file at a time on a small machine. The specs expect the database container to be named `supabase_db_sbwork` (override with `E2E_SB_DB_CONTAINER`).
3. The first Docker image pull failed once on a network drop (DNS errors); retrying worked.
4. A new Supabase workspace has no menu: the specs load it with Settings, "Load sample data", then "Clear sample event".
5. The build writes to `.next-sb` (new `NEXT_DIST_DIR` support in `next.config.ts`). Building this way also rewrites `next-env.d.ts` and `tsconfig.json`; revert those with `git checkout` before committing.

# Order-edit fixes (branch qa/order-edits-oct19)

Nothing pushed or deployed. Production Supabase and Vercel were never touched; every database check ran on a local Supabase.

**STATUS (final for this batch):** all seven fixes are committed and the checks on the final code are green: full local Playwright suite **43 of 43 passed** (0 failed, 0 skipped, 0 flaky, 2.2 min, one worker), typecheck clean, `next lint` no warnings or errors, unit tests 95 passed, production build succeeded, fix 6 specs pass against a local Supabase. The Supabase-database specs are run separately (see "Gate results").

| # | Fix | Commit state | Verified |
|---|---|---|---|
| 1 | Donation field is one "Revenue share %" field (charity or collab), Event Summary labels renamed; stored field and CSV columns unchanged | committed | typecheck only |
| 2 | Placeholder no longer cut off (short example, explanation in the wrapping hint) | committed | typecheck only |
| 3 | Minus at quantity 1 removes the line (new-order panel and Edit Order) | committed | local e2e, 2 tests pass |
| 4 | Edit Order customize panel open by default (new-order flow untouched) | committed | local e2e passes |
| 5 | Make active leaves the UI current | committed | live local Supabase repro failed before and passes after; unit tests; the 3 Make active specs passed |
| 6 | Atomic item replacement | committed | unit tests; live local DB test; two-device UI test fails on the old code and passes on the new (see below) |
| 7 | Edit Order row overlap | committed | local e2e at 360, 390 and 1280 px pass; screenshots checked by eye |

## Fix 5 root cause
A Realtime UPDATE payload leaves out unchanged large out-of-line jsonb columns; the event's `menu_snapshot` (about 4 KB) is one. The store rebuilt the event from the payload alone, so its snapshot id became its own id and the lookup failed: the sidebar card showed 0 orders and Event Summary fell back to All Events until a reload. `fromRealtimeEvent` now keeps the snapshot link and fixed costs already held.

## Fix 6: what is and is not proven
- **Apply `supabase/migration-replace-order-items.sql` to production before the atomic path works.** Until then the app falls back to the old two-step delete + insert (it logs a warning), so deploying the app first is safe but gives no atomicity. Applied to the LOCAL database only.
- Unit tests pass: one rpc call with the right payload, fallback when the function is missing, no blind delete after a real failure.
- Earlier in this session a live-database test passed: while the transaction was open, readers saw only the complete old item set, then only the complete new set.
- Finding: on this stack DELETE events do not reach other devices (the subscription filters by workspace_id and a DELETE payload carries only the id), so another device applied only the INSERTs and showed old and new rows together until the next 5 s poll. That is the likely cause of the reported flash. The store now re-reads the whole order (debounced 250 ms) on item INSERTs it does not hold and on DELETEs.
- **Live DB test (passes):** while the replacement transaction is open, readers see only the complete old set; after commit only the complete new set.
- **Two-device UI test (passes on the new code, FAILS on the old code):** device A replaces both lines of an order with a fresh line (new id) while every order_items INSERT is slowed by 0.5 s on the local DB. Run against the pre-fix-6 store and writer, device B rendered `[C1K1, C1K2, C0K1]`, i.e. old classic + old cheesecake + the new cheesecake on screen together (the reported flash). On the current code it renders `[C1K1, C0K1]`. An earlier version of this test (which kept a line's id) passed on both, so it proved nothing; it was replaced.

## Gate results
- Typecheck: clean. `next lint`: no warnings or errors. Unit tests (vitest): 95 passed (90 before).
- Full local Playwright suite: **43 passed, 0 failed** on the final code (`b8e2a87`). An earlier run on a fresh production build had 42 passed, 1 real failure and 18 failures from the Supabase specs being picked up by the local config. Both were fixed:
  - `e2e/20-orders-edge.spec.ts` "quantity cannot go below 1" asserted the old behaviour; fix 3 changes it on purpose (minus at 1 removes the line), so the test now asserts that.
  - `playwright.config.ts` now ignores `e2e/supabase/**` (those run only with `playwright.supabase.config.ts` against a local Supabase).
- Supabase-mode specs (`npx playwright test -c playwright.supabase.config.ts`, needs a local Supabase): last results were 60-atomic 2/2 pass; 30-make-active 3/3 and 50-activate-refresh 1/1 passed earlier in this batch. 10-pairing, 20-edit-pricing, 40-realtime were not re-run in this batch after the fix 5 and 6 code changes.

## Separate, unexplained issue: wrong event deleted (needs its own investigation)
In one run of `30-make-active`, creating two events quickly ("Early" then "Late") and then using Delete event on Event Summary deleted "Early" in the database while the UI showed "Late" selected. It passed in two other runs. Unproven guess: a late Realtime echo of the first event's INSERT (is_active true) flipped the active event locally just before Event Summary opened, so it defaulted to the wrong event. Not fixed in this batch. The test now waits for the sidebar card and 2 s of settle time, which may hide it.

## Feature: custom / off-menu drink (branch `feature/custom-items`, two rounds)

**What it is.** A "+ Custom drink" option in order entry (Live Orders header and the order panel's Items step), in Edit Order (Add item picker) and in the combo picker ("CUSTOM DRINK..."). Order entry and Edit Order are separate code paths (the cart in `LiveOrders`/`OrderFlow`, and the draft list in `EditOrderModal`); both are done and both go through the same `deriveOrderItem`, which stamps price and cost.

### Rules (after the revision round)
- **Price**: 6.70 flat + 0.20 per topping. Bases never change it (2 bases + 2 toppings = 7.10).
- **Cost = tea + milk + toppings + packaging**, every amount from recipes the menu already has, nothing hardcoded:
  - **Tea**: the standard amount of each selected tea. Several teas split it evenly (2 = half each, 3 = a third each).
  - **Milk**: added automatically to a tea drink, one full standard amount whatever the number of teas. "Milk only" is the base for a drink with no tea. The milk choice (whole / lactose free) works like a menu drink's and re-costs the line.
  - **Toppings**: the standard amount of each.
  - **Packaging**: read from the recipes, not a dollar figure: the ingredients that are not a tea, milk, cream or topping and that more than half of the active drinks use (with the seed menu: cup, lid, straw, ice, agave, about $0.54 on a 16 oz drink). It follows ingredient price changes and menu changes. A one-off ingredient (the chocolate spread) is used by too few drinks to count.
  - Everything scales by the event cup size / 16 oz exactly like a menu drink (that includes packaging lines, as it does for menu drinks).
- **Where "standard amounts" come from** (unchanged and reused, not invented): the amount the first drink recipe (active first, then menu order) uses for that ingredient. Standard milk = the milk line of the first drink that has one, with that drink's default milk. A cream no recipe uses (banana cream in the seed menu) takes the cream pool's amount.
- **Combo**: $10 flat covers a custom drink at $6.70 or $6.90; each topping beyond the first adds $0.20 (3 toppings = $10.40). Offered as a suggestion when a custom drink and a pastry are in the cart, and in the combo picker. The combo price is stamped on the line, and combo revenue and cost still add up in the Event Summary drink/pastry split.
- Custom drinks are non-taxable in the CSV like unknown items; cost, price and name are snapshotted at order time (sale-time values survive later ingredient price changes and Edit Order saves).

### Base / topping flag (this round's migration)
- New column `ingredients.custom_role` (`base` | `topping` | `none` | null). Migration: `supabase/migration-add-ingredient-custom-role.sql` (also added to `schema.sql` for fresh installs).
- Menu Manager > Ingredients has a "Custom drink" column to set each ingredient to Base (tea), Topping or Neither (and the New ingredient form has the same field). Milk-pool ingredients show "milk (automatic)" and are never offered.
- The builder's two dropdowns list only ingredients whose role is base or topping and that a drink recipe uses (otherwise they cannot be costed), plus "Milk only" in the bases.
- **The migration backfills** roles once so existing menus keep working: creams and purees become toppings; matcha / hojicha / tea / earl grey / genmaicha / sencha / chai (never the milk pool) become bases. Review them in Menu Manager. Rows it does not match stay null.
- **Without the column the app keeps working.** An ingredient whose role was never set (null / column missing) falls back to the old name guess, so the builder still shows teas and toppings. Setting a role before the migration is run reports a red banner ("run migration-add-ingredient-custom-role.sql"), saves the rest of that edit, and keeps the role only on that device until reload. Adding an ingredient with a role falls back to saving it without the role. Ordinary ingredient edits never send the column.

### MIGRATION: apply to production before the flag and dropdowns are fully working
- **`supabase/migration-add-ingredient-custom-role.sql` must be run in the production Supabase SQL editor.** It has NOT been applied to production (nothing here touched production). Run it once; it is safe to re-run. The app can be deployed before or after it.
- **What depends on it**: the stored base/topping/neither flag, the Menu Manager control persisting across reloads and devices, and the dropdowns being driven by saved flags rather than the name guess.
- **What does NOT depend on it**: the packaging in cost, the automatic milk, the even tea split, milk only, and the combo pricing. Those are app logic only and work today, with or without the column. (Custom orders themselves need no migration either: a custom line is an ordinary `order_items` row whose text `menu_item_id` encodes the selection.)
- Separate, still pending from earlier work: `migration-grant-anon-extras-revisions.sql` and `migration-replace-order-items.sql` (unrelated to this feature).

### Verified
- Unit: 137 pass (115 before this round + 8 role/serializer/writer-fallback + custom-item tests rewritten to 34 for packaging, automatic milk, even tea split, milk-only, flag-driven dropdown, role fallback, combo price, combo suggestion, split of combo revenue and cost).
- Local e2e (blank Supabase env): 50 pass (6 custom-drink tests: dropdowns list only teas / toppings, cost and price preview, milk only, Menu Manager flag changes the dropdowns, custom combo $10.40, Edit Order add, base required).
- **Against a LOCAL Supabase** (applied only to the local database, then stopped; nothing touched production): `e2e/supabase/70-custom-item.spec.ts`, 2/2.
  1. Column absent: the builder works from the name guess, a custom order saves, setting a role shows the migration banner while another ingredient edit still saves.
  2. Seeded with the column absent, migration applied: the backfill marked Hojicha / Matcha / Earl Grey as base, Ube cream / Strawberry puree as topping, and left Whole milk, Agave and the cup null; a role set in Menu Manager persists across a reload; the dropdown follows it; a custom order, a $10.40 custom combo and an Edit Order add (through the atomic `replace_order_items` function) are stored with the right `menu_item_id`, price, cost and milk name, the original line keeps its sale-time cost through the edit, and everything reads back after a full reload.
  - The other Supabase specs were re-run too: 20 passed in total (10 pairing, 20 edit/pricing, 30 make-active, 40 realtime, 50 activate-refresh, 60 atomic edit, 70 custom).
  - `40-realtime` had never produced a result before (see the earlier note); on its first run it failed because the spec polled `order_items.status`, while Start sets `orders.status`. The spec was wrong, not the app; fixed and it passes.

### Known limits
- A new ingredient with a name the guess does not recognise is not offered until its role is set (the guess only applies to never-set rows; use the Menu Manager control).
- The components of an existing custom line cannot be changed in Edit Order; remove the line and add a new custom drink.
- Which drink counts as "standard" is the first in menu order, so reordering the menu can change a standard amount (for example the milk amount).
- Packaging detection is "used by more than half of the active drinks". A menu with very few drinks, or where packaging differs a lot per drink, may need the menu tidied.
- Helper mode shows the price but never cost or margin in the builder.

### Gates (final code of this round)
Typecheck clean; `next lint` clean; vitest 137 passed; `next build` succeeds; full local Playwright suite 50 passed (43 + revenue-share editor 1 + custom drink 6); Supabase-mode suite 20 passed against a local Supabase (now stopped).

## Feature: prepared (composite) ingredients (branch `feature/prepared-ingredients`, off main)

**What it is.** An ingredient is either RAW (cost typed in, as always) or PREPARED: made from raw ingredients, with its cost per unit worked out from that recipe. A drink uses a prepared ingredient as ONE line, picked from the same ingredient list and the same recipe picker as any raw ingredient. When a raw price changes, it flows into the prepared ingredient and every drink that uses it.

### How cost worked before, and what changed
- A raw ingredient costs `packagePrice / packageAmount` per canonical unit (g / ml / piece). A menu item is a list of lines (ingredient, amount, unit); `computeItemCost` (src/lib/calc.ts) sums each line's cost, swaps the milk / cream pool choice, and scales every line by the event cup size / 16 oz. Nothing was stored for an ingredient's cost: it is computed from the current ingredient list each time.
- **Snapshotting (unchanged, and prepared ingredients honour it for free).** Placing an order calls `computeItemCost` in `deriveOrderItem` and stores the result as the line's `costSnap`. Edit Order keeps that stamp for an unchanged line. Because a prepared ingredient's price is computed inside the same function, from the same ingredient list, the stamped cost already includes it and later raw price changes cannot rewrite a past order. The event's frozen menu snapshot copies the ingredient objects (including the new fields).
- **New in the cost code:** `ingredientCostPerCanonical(ing, ingredients)` and `lineCost(line, ing, ingredients)` take the ingredient list; for a prepared ingredient the per-unit cost is `(sum of its raw sub-recipe line costs for one batch) / (yield)`. `computeItemCost` passes its list through, so existing menu-item costing is unchanged for raw ingredients (tested: a raw-only drink costs exactly what it did).

### Model
- `Ingredient.kind` (`raw` default | `prepared`) and `Ingredient.subRecipe` (the raw ingredients and amounts of ONE batch).
- **The yield is stored in the existing `package_amount` + `unit` columns** (for example 32 and fl_oz), and `package_price` is 0 for a prepared ingredient. Nothing about cost is stored; it is always computed.
- **One level only, enforced in three places** (`src/lib/prepared.ts`): the recipe picker lists only raw ingredients (not prepared ones, not itself); the reducer and the store drop any sub-recipe line that names a prepared ingredient, itself or a missing ingredient (so the database receives what the reducer applied); and a raw ingredient that is used in a prepared ingredient's recipe cannot be turned into a prepared one (its Type control is disabled with a reason, and the rule also holds in the reducer). A prepared ingredient found inside another's recipe (for example from older data) adds $0 rather than nesting. Deleting an ingredient that is in a prepared recipe is blocked with a message.

### Menu Manager
- Ingredients list: new **Type** column (Raw / Prepared). A prepared row shows its cost per batch and per unit (computed, not editable), its yield and yield unit (editable, same fields), and a **Recipe** button. Switching a raw ingredient to Prepared opens the recipe editor; switching back asks first, removes the recipe, and you set a price.
- **Recipe editor**: list raw ingredients and amounts for one batch, set the yield and unit, see the cost of a batch and per unit update live, Save.
- New ingredient form has a Type choice (a prepared one asks for its yield, then use the Recipe button).
- Finance shows prepared ingredients with their computed batch cost and per-unit cost. Sorting by price / unit cost / quantity uses the computed values.

### MIGRATION: apply to production before prepared ingredients work
- **`supabase/migration-add-prepared-ingredients.sql` must be run in the production Supabase SQL editor.** It has NOT been applied to production (nothing here touched production). It adds `ingredients.kind` (text, default `raw`, every existing row stays raw) and `ingredients.sub_recipe` (jsonb). Run once; safe to re-run. Also added to `schema.sql` for fresh installs.
- **Until it is run, prepared ingredients cannot be saved.** The app still works for everything raw (no change in behaviour or cost), so it can be deployed before the migration. If someone creates a prepared ingredient before the migration, the app says so in a red banner ("run migration-add-prepared-ingredients.sql"), does NOT save it as a raw ingredient (that would cost $0), and, when converting an existing raw ingredient, does not zero its price in the database. The prepared ingredient then exists only on that device and is lost on reload, so do not use one in drinks you rely on until the migration has been run.

### Verified
- Unit tests: 121 pass (95 on main + 26 new). New: per-unit cost = sum of raw lines / yield (including a yield in another unit, a line in pounds, a zero yield); a drink using a prepared ingredient as one line costs raw lines + per-unit cost x amount (also in fl oz and at a different cup size); one-level enforcement (prepared, self and unknown lines dropped; a used raw ingredient cannot become prepared; the rest of that edit still applies; a prepared ingredient inside a recipe adds 0); a raw price change flows into the prepared ingredient and the drink by exactly the expected amount; an order stamps the cost at that moment and a later raw price change does not change it (also through an Edit Order quantity change), while a new order uses the new price; the event's frozen snapshot keeps the prepared definition and its prices; serializer round trip and the writer fallback without the columns.
- Local e2e: 47 pass (3 new prepared-ingredient tests through the real UI: define a recipe and yield with live cost, use it as one line in Classic Matcha and place an order with the exact expected `costSnap`; double the agave price and see the batch cost and the next order's cost follow while the earlier order keeps its cost; the picker excludes prepared ingredients and the used raw ingredient's Type is locked).
- **Against a LOCAL Supabase** (migration applied to the local database only, then stopped; nothing touched production): `e2e/supabase/80-prepared.spec.ts`, 2/2. (1) Columns dropped: raw ingredients seed and edit as ever; creating a prepared one shows the migration banner and is NOT stored (0 rows), and a raw price edit still saves. (2) Seeded without the columns, migration applied: every existing ingredient is `raw`; a prepared ingredient is stored with `kind=prepared`, `sub_recipe` listing the two raw ingredient ids, yield 500 ml, price 0; Classic Matcha stores one line for it; an order's `cost_snap` equals raw lines + 30 ml x (batch / 500); the event snapshot carries the prepared definition; after a reload it is still prepared with the same batch cost; doubling the agave price updates the batch cost, a new order's `cost_snap` rises by exactly the agave share (5 ml direct + 6 ml in the syrup), and the first order's stored `cost_snap` is unchanged. The other Supabase specs were re-run: 20 passed in total.
- `40-realtime` is wrong on main (it polls `order_items.status`, but Start sets `orders.status`), so it fails on main. Fixed here with the same one-line change as on `feature/custom-items` (identical hunk, so the two branches merge cleanly).

### Known limits
- The custom drink builder was not touched on this branch. On the integration branch it costs prepared ingredients from their recipe (see the Integration section at the end).
- A prepared ingredient used in a drink, then converted back to raw, becomes a raw ingredient with price 0 until a price is entered (the app asks before converting).
- If a raw ingredient is deleted on another device while it is in a prepared recipe, that line adds $0 until the recipe is edited (deleting it here is blocked).
- The milk / cream pool can still only be set in seed data, as before; a prepared ingredient can carry a pool like a raw one.

### Gates (final code)
Typecheck clean; `next lint` clean; vitest 121 passed; `next build` succeeds; full local Playwright suite 47 passed; Supabase-mode suite 20 passed against a local Supabase (now stopped).


## Integration: custom drinks + prepared ingredients (branch `integration/custom-prepared`, off main)

`feature/custom-items` and `feature/prepared-ingredients` were both cut from main (`5a823aa`) and merged here, custom first, then prepared. NOT pushed, NOT deployed; the two sections above describe each feature; this section is what the integration added or decided.

### Conflicts and how they were resolved (8 files)
- **Keep both** (`types.ts`, `schema.sql`, `serialize.ts`, `reducer.ts`, `REPORT.md`): both features' additions kept. `Ingredient` now carries `customRole`, `kind` and `subRecipe`; `ingredients` has `custom_role`, `kind` and `sub_recipe`.
- **`MenuManager.tsx`**: the ingredient table has both a **Custom drink** (role) column and a **Type** (Raw / Prepared) column, and the New ingredient form has both the Type and the Custom drink role fields.
- **`save-errors.ts`**: one shared "column missing" check with two predicates (`isMissingRoleColumn`, `isMissingPreparedColumn`) and both migration hints.
- **`writer.ts`**: one ingredient write path that handles ANY combination of the two migrations (below).
- `calc.ts` and `40-realtime.spec.ts` merged automatically (the realtime fix was identical on both branches).

### The writer fallback (any combination of the two migrations)
The two migrations are independent, so production can have neither, either one, or both. Whatever the combination:
- A **prepared ingredient is never saved as a raw row** (it would cost $0). If the prepared columns are missing it is not saved at all, with a red banner naming `migration-add-prepared-ingredients.sql`.
- A **price, yield or unit that belongs to a prepared ingredient is never written onto the database's raw row**. This covers a hazard the separate branches did not: after a failed raw-to-prepared conversion, the ingredient is prepared only on that device, and a later recipe or yield edit used to be sent to the database as plain `package_amount` / `unit`, overwriting the raw row. The writer now remembers (per client) that the prepared columns are missing, takes the ingredient's pre-edit state from the store, and strips those fields.
- A missing `custom_role` column only drops the role (reported after the ingredient itself is known to be saved); everything else in the edit still saves. Both missing: both are reported; the edit still saves what is safe.
- An ordinary edit of a raw ingredient never sends any new column.

### The cross-feature cost bug, fixed
- `custom-item.ts` called `lineCost` without the ingredient list, so a PREPARED ingredient used as a tea, topping, milk or packaging in a custom drink cost $0. It now passes the list: a prepared topping costs (standard amount x computed per-unit cost), a prepared base is costed and split evenly with other teas, and a raw price change flows raw -> prepared -> custom drink. The placed order still keeps its stamped cost.
- **How a prepared ingredient gets a role**: exactly like a raw one, with the Custom drink role control (it is on every non-milk row, prepared included). A prepared ingredient with no role is **not offered**, and the custom drink builder now says so ("Not offered: X (prepared, no custom drink role). Set a role in Menu Manager"), instead of silently missing from the dropdowns.
- **Packaging**: a prepared ingredient with no role is never counted as packaging, even if most drinks use it (it is something made, a syrup or cream, not a cup or lid; counting it would add it to every custom drink). If it is explicitly marked **Neither**, it is treated like agave: a standard ingredient in most drinks, and it is costed from its recipe, not $0.

### New tests
- **Unit** (`custom-with-prepared.test.ts`, 14): prepared topping and prepared base costed from their recipes with exact expected numbers (and not $0), even split with another tea with milk staying full, a raw cream price change flowing into the custom drink by exactly the expected amount, cup-size scaling, milk-only with a prepared topping; the role dropdown lists a prepared ingredient flagged base/topping, hides an unflagged one (and the builder reports it) or one marked Neither; packaging rules (unflagged prepared excluded, Neither included and costed, raw packaging unchanged); an order stamped from the recipe and kept after a later raw price change. Mutation-checked: removing the list argument makes 6 of them fail.
- **Unit** (`ingredient-writer-matrix.test.ts`, 32): the writer for each of 4 database states (neither / role only / prepared only / both) x 8 operations: plain raw add and edit; raw with a role; role set with another edit; prepared add; raw to prepared; a device-only prepared ingredient edited afterwards; prepared back to raw; an ordinary edit never touching new columns. Mutation-checked: letting the writer send a prepared yield/price fails 4.
- **Local e2e** (`95-custom-prepared.spec.ts`): through the real UI, a prepared ingredient used in a recipe is not offered until it has a role (and the builder says so), then is offered; both the Type and the Custom drink role controls exist on its row and in the New ingredient form; the custom drink cost preview and the stamped `costSnap` come from its recipe; doubling a raw price changes the next order only.
- **Supabase-mode** (`90-integration.spec.ts`, 4, against the local database): the same scenario with neither migration, only the role migration, only the prepared migration, and both. Every state: a prepared ingredient is stored only when its columns exist (otherwise 0 rows and a banner), a role is stored only when its column exists, a raw ingredient converted to prepared is never zeroed or overwritten in the database when the columns are missing, and ordinary raw edits always save. Both migrations applied: roles and prepared ingredients persist across a reload, the custom drink with a prepared topping is stored (`custom:` id, price 6.90, `cost_snap` matching the recipe-based expectation), a raw price change flows through for the next order only, and everything reads back.

### Migrations (both still NOT applied to production; independent, either order, either may stay unapplied)
- `supabase/migration-add-ingredient-custom-role.sql` (role flag + backfill) and `supabase/migration-add-prepared-ingredients.sql` (kind + sub_recipe). Apply both to production before the base/topping dropdowns driven by saved roles and prepared ingredients fully work. Until each is applied the app keeps working and reports (see above). Still pending from earlier, unrelated: `migration-grant-anon-extras-revisions.sql` and `migration-replace-order-items.sql`.

### Gates (integration branch)
Typecheck clean; `next lint` clean; vitest **209 passed** (137 on custom-items + 26 from prepared-ingredients + 46 new); `next build` succeeds; full local Playwright suite **54 passed** on the second run. The first full run had 53 passed and 1 failure in `40-contract-helper-misc` "two devices submitting at the same moment" (a two-tab localStorage race test that passed 3 of 3 times when re-run alone and passed in the second full run); it looks timing-sensitive under load and was not touched by this work, but it is worth knowing about. Supabase-mode suite **26 passed** against a local Supabase (now stopped; both migrations applied to the LOCAL database only).


## Collab profit / expense split (branch `feature/collab-split`, off main; not pushed)

### What it does
A collab event has a partner who gets a share of the **profit** and who also pays part of the **ingredients**. Event Summary (single event) gets a "Collab split" panel:

    profit            = revenue - costs                 (the number the page already calls Profit)
    partner take-home = profit x split% - partner contribution
    your take-home    = profit - partner take-home

Two inputs per event, both editable at any time (and removable with "Remove collab"): **Partner profit share %** (0 to 100) and **Partner ingredient contribution $** (a dollar amount, never a percentage). The panel shows profit, the partner's share, the contribution, then the two take-homes. Worked example from the brief ($500 revenue, $100 costs, 40%, $50): partner = 0.40 x 400 - 50 = **$110**, you = **$290** (unit test).

### Decisions (flag any you disagree with)
- **Fit with the event model:** two optional fields on the event, `collabProfitPct` and `collabContribution` (columns `events.collab_profit_pct`, `events.collab_contribution`). An event is a collab when either is set; a blank half counts as 0. No separate "is collab" flag to keep in sync. Existing events are untouched.
- **The old revenue share (`donationPct`) is kept, not replaced.** It is a different thing (a cut of *revenue* for charity events, shown as Net profit and rolled into the all-events totals), and existing events use it. The collab split works from the profit before any revenue share; if both are set the panel says so. Say if you want them merged or the old field retired.
- **"Profit" is the page's existing profit**, i.e. revenue minus total cost *including any fixed costs on the event* (Total cost = ingredients + fixed). With no fixed costs it is exactly revenue minus ingredient costs. If you want the split to ignore fixed costs, that is a one-line change.
- A contribution larger than the partner's share makes their take-home **negative** (and yours larger than the profit); the formula is applied as written and the panel adds a one-line note. A loss is split by the same formula.
- Not shown for contract events (no per-drink profit) and not added to the New Event dialog (add it from Event Summary after creating, same as the revenue share editor). Not included in the All-events aggregate or the CSV / tax export.
- The brief ended mid-sentence ("the two final take-home numbers (partner's and"); I read it as "...and yours".

### Migration (NOT applied to production)
`supabase/migration-add-collab-split.sql`: two nullable numeric columns with checks (share 0 to 100, contribution >= 0), `notify pgrst`. Safe to re-run; also added to `schema.sql`. The app works before it is run: creating and editing events never names the new columns unless a split is set; saving a split without them retries the rest of the edit, shows a red banner naming the file, and the split lasts on that device only.

### Tests / gates
- Unit: `collab-split.test.ts` (11: worked example, take-homes always sum to profit, negative take-home, 0%, loss, input parsing), `collab-persistence.test.ts` (7: row round trip, ordinary create never sends new columns, clearing writes nulls, writer fallback with/without the migration). vitest **227 passed**; typecheck and `next lint` clean.
- Local e2e `96-collab-split.spec.ts` (2): validation, add / edit / reload / remove, numbers match the formula from the stamped order costs. Full local suite **55 of 56** on the first run; the one failure was the known-flaky "two devices submitting at the same moment" (passes 3 of 3 alone). 
- Supabase mode against a LOCAL Supabase: `e2e/supabase/100-collab-split.spec.ts` (2). With the migration: stored in `events`, shown correctly, survives reload, edit and removal reach the database, running the migration twice is harmless, and the database rejects share 101, share -1 and contribution -5. Without it: an ordinary event still creates and saves, the split raises the banner, and other event edits (revenue share) still save. Local Supabase stopped afterwards. Production Supabase was never touched.


## Collab split: rounding fix, and the revenue share field retired (branch `fix/collab-split-rounding-remove-revshare`, off main; not pushed)

### 1. Rounding fix
Cause: each number on the panel was rounded for display on its own from unrounded values, so the pieces could miss the profit by a cent (profit $39.95 showing $9.97 + $29.97 = $39.94). Now everything is worked out in whole cents, once:
- profit is rounded to cents (this is the profit shown); partner share = round(profit x share% / 100); partner take-home = share - contribution (contribution rounded to cents);
- **your take-home = profit - partner take-home**, a subtraction, never its own percentage. The two always sum to the profit shown, exactly, and the lines shown (share - contribution = partner) agree too.
- Half cents round away from zero; float noise (1997.4999999) is treated as the half it is.
Tests (`collab-split.test.ts`, now 26): 13 named cases incl. profit 39.95 at 50% (the half cent), sub-cent profit 39.9537, a loss, contribution above the share, 100%; the screen's exact case; and 5,000 pseudo-random profits / percentages / contributions, all asserting partner + yours === profit in whole cents. Checked against the old method: 8 of them fail with it. The e2e also reads the numbers off the screen and checks they add up.

### 2. Revenue share (`donationPct`, column `donation_pct`) retired
Everything that touched it:
- **Wrote it (removed):** New event dialog field; Quick add past event field and the `donationPct` argument of `buildQuickAddEvent`; the Event Summary editor (`RevenueShareEditor.tsx`, deleted).
- **Read it (kept, so history does not change):** single-event Event Summary (Revenue share tile, Net profit and margin, and the "- Revenue share / Net" rows of the item table); the **all-events aggregate** (`totalDonations` -> Revenue share tile, net profit, the "- Revenue share" row; contract events excluded as before); the tax export "Donation %" column; and the Supabase read / insert / patch code and the `DbEvent` type.
- **Also removed:** the "a revenue share is also set on this event" note from the collab panel.
Approach: the field is retired, not deleted. **No migration, the column stays**, and every stored value is kept. An event that already has a revenue share still shows it, read-only (nothing offers it to add, edit or clear), with the same tiles and the same numbers as before; the all-events totals still subtract it; the tax export still lists it. New events never get one. A later edit to such an event (for example adding a collab split) does not touch the stored value (tested in local mode and against the local database). A collab split on an event that also has an old revenue share still works from the profit before the revenue share, as before.
Tests: `97-revenue-share-retired.spec.ts` (not offered in New event or on the summary; a stored 10% event keeps its tiles, Net profit and all-events total, shows no editor, and keeps the value after a collab edit); the old add/edit/remove revenue share e2e was removed; the Supabase spec now seeds `donation_pct = 10` in the local database and checks it is shown read-only and untouched.

### Gates
Typecheck clean, `next lint` clean, `next build` succeeds, vitest **242 passed**, full local Playwright **57 of 57** (the first full run had 55 of 57: two failures in the new 97 spec's own selectors, fixed and rerun; the known-flaky two-tab test passed this time), Supabase-mode suite **28 passed** against a local Supabase (now stopped). Production Supabase was never touched; no migration in this change.
