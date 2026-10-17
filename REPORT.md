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
