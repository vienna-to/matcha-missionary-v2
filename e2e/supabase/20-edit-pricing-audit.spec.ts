import { createEvent, goTab, placeOrder } from "../support";
import { addMenuItem, baristaCard, modal, setMenuPrice } from "../extra";
import { acceptDialogs, expect, pairNewWorkspace, seedMenu, sql, test } from "./sb";

/**
 * FIXES.md item 1 (BUG-QA-1 / QA-1b) against a live database: editing a placed
 * order must keep every line's sold price and cost, and an item added to the menu
 * after the event was created must keep its real name and price. Plus the
 * order_revisions audit trail for edits and deletes.
 */
type Line = {
  menu_item_name_snap: string;
  quantity: number;
  price_snap: number;
  list_price: number;
  price_charged: number;
  cost_snap: number;
};

const lines = (ws: string, eventName: string): Line[] =>
  sql(
    `select oi.menu_item_name_snap, oi.quantity, oi.price_snap::float, oi.list_price::float,
            oi.price_charged::float, oi.cost_snap::float
       from public.order_items oi
       join public.orders o on o.id = oi.order_id
       join public.events e on e.id = o.event_id
      where oi.workspace_id='${ws}' and e.name='${eventName}'
      order by oi.menu_item_name_snap`,
  );

async function editOrder(page: import("@playwright/test").Page, n: number, fn: (dlg: import("@playwright/test").Locator) => Promise<void>) {
  await goTab(page, "Barista Queue");
  await baristaCard(page, n).getByTitle("Edit").click();
  const dlg = modal(page, new RegExp(`Edit order #${n}`));
  await fn(dlg);
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
}

test.describe("item 1: edit order keeps sale-time price and cost (Supabase)", () => {
  test("price raised before the sale: note-only edit, then qty edit, never re-prices; audit trail records pre-images", async ({ page }) => {
    acceptDialogs(page);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "EditPrice" });
    // price goes up AFTER the event snapshot was taken, then the sale is rung up at the new price
    await setMenuPrice(page, "Classic Matcha", 8);
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Sold at 8", pay: "Cash" });
    await expect.poll(() => lines(ws, "EditPrice").length).toBe(1);
    const sold = lines(ws, "EditPrice")[0];
    expect(sold.price_snap).toBe(8);
    expect(sold.cost_snap).toBeGreaterThan(0);

    // 1) note-only edit
    await editOrder(page, 1, async (dlg) => {
      await dlg.locator("textarea").first().fill("just a note, no item change");
    });
    await expect
      .poll(() => sql(`select notes from public.orders where workspace_id='${ws}'`)[0].notes)
      .toBe("just a note, no item change");
    // replaceOrderItems is delete-then-insert (two requests), so wait for the rows to be back
    await expect.poll(() => lines(ws, "EditPrice").length).toBe(1);
    let after = lines(ws, "EditPrice");
    expect(after[0]).toMatchObject({
      menu_item_name_snap: "Classic Matcha",
      quantity: 1,
      price_snap: 8,
      list_price: 8,
      price_charged: 8,
    });
    expect(after[0].cost_snap).toBeCloseTo(sold.cost_snap, 6);

    // 2) quantity edit: price and per-unit cost stay at their sale-time values
    await editOrder(page, 1, async (dlg) => {
      await dlg.locator("div.min-w-7").first().locator("xpath=following-sibling::button").click();
    });
    await expect.poll(() => lines(ws, "EditPrice")[0]?.quantity).toBe(2);
    after = lines(ws, "EditPrice");
    expect(after[0].price_snap).toBe(8);
    expect(after[0].list_price).toBe(8);
    expect(after[0].price_charged).toBe(8);
    expect(after[0].cost_snap).toBeCloseTo(sold.cost_snap, 6);

    // audit trail: each save wrote a pre-image of the order as it stood before the edit
    await expect
      .poll(() => sql(`select count(*)::int n from public.order_revisions where workspace_id='${ws}'`)[0].n)
      .toBeGreaterThanOrEqual(2);
    const revs = sql(
      `select action_type, order_number, snapshot from public.order_revisions
        where workspace_id='${ws}' order by occurred_at, id`,
    );
    const replaces = revs.filter((r) => r.action_type === "replace_items");
    expect(replaces).toHaveLength(2);
    expect(replaces[0].order_number).toBe(1);
    expect(replaces[0].snapshot.items[0].priceSnap).toBe(8);
    expect(replaces[0].snapshot.items[0].quantity).toBe(1); // before the qty edit
    expect(replaces[1].snapshot.items[0].quantity).toBe(1);
    expect(revs.some((r) => r.action_type === "update")).toBe(true); // the notes change

    // delete: the order goes, its pre-image stays
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Remove").click();
    await expect
      .poll(() => sql(`select count(*)::int n from public.orders where workspace_id='${ws}'`)[0].n)
      .toBe(0);
    await expect
      .poll(() => sql(`select count(*)::int n from public.order_items where workspace_id='${ws}'`)[0].n)
      .toBe(0);
    await expect
      .poll(() =>
        sql(`select count(*)::int n from public.order_revisions where workspace_id='${ws}' and action_type='delete'`)[0].n,
      )
      .toBe(1);
    const [del] = sql(
      `select snapshot from public.order_revisions where workspace_id='${ws}' and action_type='delete'`,
    );
    expect(del.snapshot.customerName).toBe("Sold at 8");
    expect(del.snapshot.items[0].quantity).toBe(2);
    expect(del.snapshot.items[0].priceSnap).toBe(8);
  });

  test("an item added to the menu after the event was created keeps its real name and price through an edit", async ({ page }) => {
    acceptDialogs(page);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "NewItem" });
    await addMenuItem(page, "Pop Special", 5);
    await goTab(page, "Live Orders");
    await placeOrder(page, { items: [{ name: "Pop Special" }], name: "Sp", pay: "Cash" });
    await expect.poll(() => lines(ws, "NewItem").length).toBe(1);
    expect(lines(ws, "NewItem")[0]).toMatchObject({ menu_item_name_snap: "Pop Special", price_snap: 5 });

    await editOrder(page, 1, async (dlg) => {
      await dlg.locator("textarea").first().fill("note only");
    });
    await expect
      .poll(() => sql(`select notes from public.orders where workspace_id='${ws}'`)[0].notes)
      .toBe("note only");
    await expect.poll(() => lines(ws, "NewItem").length).toBe(1);
    const after = lines(ws, "NewItem");
    expect(after[0].menu_item_name_snap).toBe("Pop Special");
    expect(after[0].menu_item_name_snap).not.toMatch(/unknown/i);
    expect(after[0].price_snap).toBe(5);
    expect(after[0].price_charged).toBe(5);
    // the item row points at the real menu item, not a placeholder
    const [ref] = sql(
      `select oi.menu_item_id, mi.name from public.order_items oi
         left join public.menu_items mi on mi.id::text = oi.menu_item_id
        where oi.workspace_id='${ws}'`,
    );
    expect(ref.name).toBe("Pop Special");
  });

  test("a multi-line order keeps every line's own price and cost after an edit (milk-swapped drink included)", async ({ page }) => {
    acceptDialogs(page);
    const { workspaceId: ws } = await pairNewWorkspace(page);
    await seedMenu(page, ws);
    await createEvent(page, { name: "Multi" });
    await setMenuPrice(page, "Classic Matcha", 9);
    await goTab(page, "Live Orders");
    await placeOrder(page, {
      items: [{ name: "Classic Matcha" }, { name: "Matcha Cheesecake" }],
      name: "Two lines",
      pay: "Venmo",
      declineCombo: true,
    });
    await expect.poll(() => lines(ws, "Multi").length).toBe(2);
    const key = (l: Line) => l.menu_item_name_snap;
    const before = Object.fromEntries(lines(ws, "Multi").map((l) => [key(l), l]));
    await editOrder(page, 1, async (dlg) => {
      await dlg.locator("textarea").first().fill("note on a two-line order");
    });
    await expect
      .poll(() => sql(`select notes from public.orders where workspace_id='${ws}'`)[0].notes)
      .toBe("note on a two-line order");
    await expect.poll(() => lines(ws, "Multi").length).toBe(2);
    const after = Object.fromEntries(lines(ws, "Multi").map((l) => [key(l), l]));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const k of Object.keys(before)) {
      expect(after[k].price_snap, `${k} price`).toBe(before[k].price_snap);
      expect(after[k].cost_snap, `${k} cost`).toBeCloseTo(before[k].cost_snap, 6);
      expect(after[k].quantity).toBe(before[k].quantity);
    }
    expect(after["Classic Matcha"].price_snap).toBe(9);
  });
});
