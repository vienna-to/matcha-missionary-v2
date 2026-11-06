# BLOCKERS.md

## NEEDS YOUR DECISION: accidental production deployment

The Vercel CLI turned the first deploy of the new project into a Production deployment, even though only a preview was intended. It is public at https://matcha-missionary-site.vercel.app. It has no env vars, so it shows no menu data and booking returns the error message with the email fallback. No secrets are exposed. It has not been linked anywhere.

The CLI says to remove it only with your approval, so it was left alone. To remove it, run: `npx vercel remove dpl_6kgLgfNcT9sGNjDdhZe4mdqnX68G --yes`. Or keep it and add env vars when you are ready to launch.

## NEEDS YOUR DECISION: auto-deploys on push

The GitHub repo is not connected to Vercel yet. Until it is, pushing a new sticker, review, or cat does not update the live site. It was left off because connecting it makes every push to `master` a public production deploy, and the production project needs its env vars first.

When you are ready: add the env vars to Production in Vercel (the same seven as Preview, plus `NEXT_PUBLIC_SITE_URL`), then run `npx vercel git connect`.

## SECURITY: finance database is open to the anon key (URGENT)

Found during read-only inspection on 2026-11-05. Do not fix this from the site repo. Hand this entry to Claude in the finance app repo (vienna-to/matcha-missionary-v2).

**The problem:** RLS is off on all nine tables in `public`, there are zero policies, and the `anon` role has broad table privileges. Anyone holding the anon key can read this data, and can change or delete most of it. The anon key is normally visible in a browser app's JavaScript.

| Table | Sensitive contents | Anon privileges |
|---|---|---|
| orders | customer names, payment details, notes | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| order_items | prices, costs, special requests | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| order_revisions | order snapshots | SELECT, INSERT, TRUNCATE |
| events | revenue targets, client names, payouts, costs | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| event_extras | amounts, payment methods, notes | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| ingredients | package prices, recipes | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| inventory_purchases | spending | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| menu_items | recipes, prices | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| workspaces | workspace access codes | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |

The REST API exposes the read and write operations. TRUNCATE is not reachable through it, but the grant should still go. Also: `submit_order`, `replace_order_items`, `set_workspace`, `current_workspace_id`, and `rls_auto_enable` are executable by anon.

**The website is not affected by the fix.** It reads only through `public_site_*` views that run with owner rights, and it never ships the anon key to browsers.

### Step-by-step RLS fix plan (for the finance repo)

1. Back up the database first. Do it on a non-event day.
2. List how the app reaches Supabase: every table call, RPC, and realtime subscription, per screen and per user type (owner, helper, barista).
3. Decide on real identity. The app currently uses `workspaces.code` with `set_workspace` and `current_workspace_id`, but nothing enforces them because RLS is off. Check how `current_workspace_id` works across pooled, stateless REST requests. A per-request setting may not persist, so a signed JWT with a workspace claim (or Supabase Auth, or server routes using the service role) is the reliable route.
4. Stop exposing workspace codes: do not allow anon to read `workspaces.code`.
5. Move writes behind authenticated paths: server routes or `SECURITY DEFINER` RPCs that validate the workspace, with a pinned `search_path`.
6. Enable RLS on each table and add workspace-scoped policies, starting with the lowest-risk tables. Test every screen after each table.
7. Do not use `FORCE ROW LEVEL SECURITY` on `events` or `menu_items` without retesting the website views. The views run as `postgres`, which currently bypasses RLS.
8. Revoke everything from anon that is no longer needed, including TRUNCATE, REFERENCES, and TRIGGER. Revoke EXECUTE on functions anon doesn't need. Keep `GRANT SELECT` on `public_site_*` views.
9. Change the database's default privileges so new tables stop granting anon TRUNCATE and related rights.
10. Rotate the anon key if it has been in any public page, then update the finance app and the website env vars.

### Finance app features that might break when access is tightened
- Helper mode via link, and any screen using a workspace code rather than a login.
- Customer-facing order submission (`submit_order`) if customers order without an account.
- Barista queue realtime: `events`, `orders`, and `order_items` are in the `supabase_realtime` publication, and realtime respects RLS.
- `set_workspace` / `current_workspace_id` flows.
- Order edits (`replace_order_items`), order revision history, and the `tg_events_single_active` trigger path.
- Dashboards and CSV-style exports reading across tables.
- Ingredient and menu editing screens.
- service_role currently has no SELECT on these tables, so any server code you add must be granted access explicitly.

## FINANCE APP FOLLOW-UP

Hand to Claude in the finance repo along with the security fix. The site works without these: it hides events, the live banner, and sold-out tags cleanly until the data exists.

**Website publishing**
1. Add fields to the event form: public name, address (plus location name and map link), show on website. They write to `site_event_details`, keyed by event id. `show_on_website` defaults to false.
2. Add a sold-out button in the barista queue, writing to `site_menu_availability` (event id + menu item id).
3. Do NOT give the anon key write access to these tables, or anyone could post fake events on the public site. Write through an authenticated server route or validated RPC.

**Costs and records**
1. Recorded cost per cup is wrong from June to October ($0.25 to $0.80); fix ingredient prices and backfill cost snapshots. Known causes to check: `Strawberry purée`, `banana puree`, `banana cream top`, and `Cheesecake base` have a $0 package price; matcha missionary lists whole milk as 6ml (others use 6 fl_oz) and has no lid; `Strawberry purée 15ml` and Agave don't convert to their package units.
2. Create real 12oz recipes (about 3g matcha, scaled milk/ice/cup) instead of copies of the 16oz ones, so campus pop-up costs are accurate. There is no 12oz cup ingredient in the real workspace yet.
3. Review the taxable flag on every menu item: cold non-carbonated drinks sold to go are likely exempt; carbonated drinks are taxable. Sexy strawberry is currently marked non-taxable while similar drinks aren't.
4. Add a "club share %" field to events (5-40%, of sales) so fundraiser payouts and true profit are calculated automatically.
5. Mark drop-off vs on-site. 6/5 and 10/1 (dated 10/2) were drop-offs; 10/18 was on-site.
6. List every event where the date in the name disagrees with the stored date, and update the stored date to match the name. The name is correct in these cases. Known examples: "10/21 ca boothing" is stored as 10/19, and "10/1 fall kickoff catering" is stored as 10/2. A wrong date on a published event means the live banner won't fire. Do this from the finance repo, not the site repo.
7. "5/29 newbie showcase" has a 02:30 start time, which looks like a typo.
8. Clean up description typos before they show publicly: "seasame", "cheescake".

## BEFORE PROMPT 2 (optional, site still builds without these)

- Reviews: add `assets-inbox/reviews.txt` with 5+ real quotes to show the reviews section.
