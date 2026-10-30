import { createEvent, goTab, placeOrder } from "../support";
import { baristaCard, modal } from "../extra";
import { acceptDialogs, exec, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * Cream used to be a per-order choice. It is retired (no screen offers it, new lines record none) but past
 * orders recorded it, and the database still holds it. Those rows must still read, display and keep their
 * stamped cost, also after an edit that leaves the line alone. Nothing is migrated or dropped.
 */
const line = (ws: string) =>
  sql(
    `select cream_choice_id, cream_name_snap, cost_snap::float, quantity
       from public.order_items where workspace_id='${ws}' order by created_at limit 1`,
  )[0];

test("an order that recorded a cream choice still reads, shows it, and keeps its cost through an edit", async ({ page }) => {
  acceptDialogs(page);
  const { workspaceId: ws } = await pairNewWorkspace(page);
  await seedMenu(page, ws);
  await createEvent(page, { name: "LegacyCream" });
  await goTab(page, "Live Orders");
  await placeOrder(page, { items: [{ name: "Ube Cream Matcha" }], name: "New order", pay: "Cash" });
  await expect.poll(() => line(ws)?.quantity).toBe(1);

  // a NEW order records no cream at all
  expect(line(ws).cream_choice_id).toBeNull();
  expect(line(ws).cream_name_snap).toBeNull();

  // make it look like an order placed back when cream was a choice, with an odd stamped cost
  exec(
    `update public.order_items set cream_choice_id = (select id from public.ingredients where workspace_id='${ws}' and name='Sesame cream'),
            cream_name_snap = 'Sesame cream', cost_snap = 1.2345 where workspace_id='${ws}'`,
  );
  await page.reload();

  // it still displays on the barista card
  await goTab(page, "Barista Queue");
  await expect(baristaCard(page, 1)).toContainText("Sesame cream");

  // an edit that only changes the quantity keeps the recorded cream and the stamped cost
  await baristaCard(page, 1).getByTitle("Edit").click();
  const dlg = modal(page, /Edit order #1/);
  await dlg.getByRole("button", { name: "More" }).first().click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => line(ws)?.quantity).toBe(2);
  expect(line(ws)).toMatchObject({ cream_name_snap: "Sesame cream", cost_snap: 1.2345 });
  expect(line(ws).cream_choice_id).not.toBeNull();
});
