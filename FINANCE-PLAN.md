# FINANCE-PLAN.md: lock down the finance app + website follow-ups

Source of findings: `SITE-BLOCKERS.md` in this folder (copied from the website repo). Read it fully before anything else. Its SECURITY and FINANCE APP FOLLOW-UP sections are the requirements.

## Goal
1. Close the security hole: the anon key can currently read, change, and delete every table (orders with customer names, events, costs, workspace codes).
2. Keep every finance app feature working, especially helper mode, the barista queue, and live orders.
3. Add the website publishing features (public event details, sold-out button).
4. Clean up the data problems found during the website build.

## Hard rules
1. **Back up first.** Before any database write, dump schema + data into `backups/` (git-ignored). If no backup method works, STOP and tell me.
2. **Never delete or truncate real data.** Data changes are UPDATEs I approved in the interview, listed in `DATA-CHANGES.md` with before and after values.
3. **Every SQL change is a numbered migration in `supabase/migrations/`**, committed to git, so it can be reviewed and reverted.
4. **Don't break the public website.** Do not alter or drop any `public_site_*` view or `site_*` table except to add the write paths in Phase B. Keep `GRANT SELECT` on `public_site_*` views for anon. Do not use `FORCE ROW LEVEL SECURITY` on `events` or `menu_items`. After every security step, run the website check below.
5. **Never give anon write access** to `site_event_details` or `site_menu_availability`.
6. **Secrets stay in `.env.local`** (confirm it is git-ignored before starting). Never print keys.
7. **Commit after each checklist item** with a clear message. Make reasonable decisions without asking, except the decision points listed in Phase 0. Log every decision in `DECISIONS.md`.
8. Only stop early if truly blocked. Write the blocker in `BLOCKERS.md` and keep going on anything that doesn't depend on it.

## Checks used throughout
- **Build:** `npm run build` clean, plus lint and types.
- **Anon lockout test:** a script using only the anon key proves it can NOT select, insert, update, or delete on any of the nine tables, can NOT read `workspaces.code`, and can NOT execute functions it no longer needs.
- **Website check:** a script proves the anon key CAN still select from every `public_site_*` view and gets the same row counts as before the change.
- **App smoke tests (Playwright):** owner flow (dashboard, events, menu manager, ingredients, purchases), helper flow (open helper link, take an order, Live Orders), barista queue (new order appears in realtime, status updates), order edit and revision history, demo workspace (`?workspace=sample`).

## Phase 0: inventory and decisions (read-only, then interview)
- [ ] Inventory every way the app reaches Supabase: each table call, RPC, and realtime subscription, per screen and per user type (owner, helper, barista, customer if any). Save it as `ACCESS-MAP.md`.
- [ ] Interview me (AskUserQuestion, up to 4 questions at a time, skip the obvious) on:
  - How owners log in (e.g. Supabase Auth email link vs something else).
  - How helpers get access without a full login (e.g. a signed, expiring helper link checked by a server route) and how long a helper link should work.
  - Whether customers ever submit orders themselves.
  - Approval of every proposed data change in Phase C (show before and after values).
  - Anything else risky you find.
- [ ] Write the final decisions into this file, then continue.

## Phase A: security (one table group at a time, test after each)
- [ ] Backup done.
- [ ] Move all writes behind authenticated paths: server routes using the service role, or `SECURITY DEFINER` RPCs that validate the workspace, with a pinned `search_path`. Grant the service role exactly what it needs.
- [ ] Stop exposing `workspaces.code` to anon.
- [ ] Enable RLS with workspace-scoped policies, lowest-risk tables first. Make sure realtime still works for the barista queue (realtime respects RLS).
- [ ] Revoke from anon everything it no longer needs (including TRUNCATE, REFERENCES, TRIGGER) and EXECUTE on functions it doesn't need. Keep SELECT on `public_site_*` views.
- [ ] Change default privileges so new tables don't grant anon broad rights.
- [ ] Anon lockout test, website check, and all app smoke tests pass.

## Phase B: website publishing
- [ ] Event form fields: public name, location name, address, map link, "show on website" (default off). Writes to `site_event_details` through an authenticated path.
- [ ] Sold-out button in the barista queue, writing to `site_menu_availability` (event id + menu item id) through an authenticated path.
- [ ] Tests: publishing an event makes it appear in `public_site_*` views; unpublished events never appear; sold-out toggles show up; anon still cannot write to either table.

## Phase C: data cleanup (only the changes I approved)
- [ ] Fix ingredient package prices and units listed in SITE-BLOCKERS.md, then backfill cost snapshots. Report average cost per 16oz drink before and after (expected around $2.40).
- [ ] Create real 12oz recipes (about 3g matcha, scaled milk, ice, 12oz cup) and a 12oz cup ingredient.
- [ ] Tax flags: show me a proposed flag for every menu item (cold non-carbonated to go = likely exempt, carbonated = taxable). Apply only what I approve.
- [ ] Add a "club share %" field to events (5 to 40% of sales) and include it in profit and payout math.
- [ ] Add a drop-off vs on-site field. 6/5 and 10/1 were drop-offs, 10/18 was on-site.
- [ ] Fix stored dates where the name's date is correct (e.g. "10/21 ca boothing", "10/1 fall kickoff catering"). Flag "5/29 newbie showcase" 02:30 start time for me.
- [ ] Fix description typos ("seasame", "cheescake").

## Phase D: wrap up
- [ ] Write step-by-step instructions for me to rotate or replace the anon key in the Supabase dashboard, then update the env vars in both Vercel projects (finance app and website). Do not rotate keys yourself.
- [ ] Write `HELPER-TEST.md`: a 5 minute checklist I run on my phone before the next pop-up (open helper link, place an order, see it in the barista queue, mark sold out, edit an order).
- [ ] Push to GitHub (Vercel auto-deploys the finance app). Confirm the deploy succeeds and the live app loads.

## Done means
All checklist items ticked, build clean, anon lockout test passes, website check passes, all app smoke tests pass, the production deploy works, and a final summary lists: what changed, every data change made, anything in BLOCKERS.md, and what I need to do (key rotation, HELPER-TEST.md).
