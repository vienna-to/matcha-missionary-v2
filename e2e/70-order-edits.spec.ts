import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { addMenuItem, baristaCard, eventOrders, modal } from "./extra";

test.describe("stepper: minus at quantity 1 removes the line", () => {
  test("new-order panel", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Stepper cart" });
    await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
    const fewer = page.locator("aside").getByRole("button", { name: "Fewer" });
    await expect(fewer).toHaveCount(1);
    await page.locator("aside").getByRole("button", { name: "More" }).click(); // 2
    await fewer.click(); // back to 1, line stays
    await expect(fewer).toHaveCount(1);
    await fewer.click(); // minus at 1 removes the line
    await expect(fewer).toHaveCount(0);
  });

  test("edit order modal", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Stepper edit" });
    await placeOrder(page, {
      items: [{ name: "Classic Matcha" }, { name: "Matcha Cheesecake" }],
      name: "Two",
      pay: "Cash",
      declineCombo: true,
    });
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    await dlg.locator("div.rounded-xl.p-2\\.5", { hasText: "Classic Matcha" }).getByRole("button", { name: "Fewer" }).click();
    await expect(dlg.getByText("Classic Matcha")).toHaveCount(0);
    await dlg.getByRole("button", { name: "Save" }).click();
    const { orders } = await eventOrders(page, "Stepper edit");
    expect(orders[0].items.map((i: { menuItemNameSnap: string }) => i.menuItemNameSnap)).toEqual(["Matcha Cheesecake"]);
  });
});

test.describe("Edit Order: customize panel is open by default", () => {
  test("sugar, ice and special requests are visible without tapping Customize", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Customize open" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Open", pay: "Cash" });
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    await dlg.getByText("Classic Matcha").first().click(); // opens the item's customize modal
    const item = modal(page, "Classic Matcha");
    await expect(item.getByRole("button", { name: /Hide customize/ })).toBeVisible();
    await expect(item.getByText("Sugar", { exact: true })).toBeVisible();
    await expect(item.getByText("Ice", { exact: true })).toBeVisible();
    await expect(item.locator("textarea, input[type=text]").last()).toBeVisible();
    // and it still collapses on demand
    await item.getByRole("button", { name: /Hide customize/ }).click();
    await expect(item.getByText("Sugar", { exact: true })).toHaveCount(0);
  });
});

test.describe("Edit Order row layout: name and controls never overlap", () => {
  for (const [label, width, height] of [
    ["phone 390px", 390, 844],
    ["narrow phone 360px", 360, 800],
    ["desktop 1280px", 1280, 900],
  ] as const) {
    test(label, async ({ page }, testInfo) => {
      // Set up at desktop width (phones use a different nav), then resize before opening the editor.
      await openApp(page);
      await createEvent(page, { name: "Row layout" });
      await addMenuItem(page, "Matcha Missionary Supreme Latte", 6);
      await goTab(page, "Live Orders");
      await placeOrder(page, { items: [{ name: "Matcha Missionary Supreme Latte" }], name: "Wide", pay: "Cash" });
      await goTab(page, "Barista Queue");
      await page.setViewportSize({ width, height });
      await baristaCard(page, 1).getByTitle("Edit").click();
      const dlg = modal(page, /Edit order #1/);
      const row = dlg.locator("div.rounded-xl.p-2\\.5").first();
      await expect(row).toBeVisible();

      const parts: Record<string, ReturnType<typeof row.locator>> = {
        name: row.locator("button").first(),
        fewer: row.getByRole("button", { name: "Fewer" }),
        more: row.getByRole("button", { name: "More" }),
        percent: row.getByTitle(/discount/i),
        adjust: row.locator('button:has(svg[class*="lucide-sliders"])'),
        trash: row.locator('button:has(svg[class*="lucide-trash"])'),
      };
      const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const [k, loc] of Object.entries(parts)) {
        const b = await loc.boundingBox();
        expect(b, `${k} is visible`).not.toBeNull();
        boxes[k] = b!;
      }
      const rowBox = (await row.boundingBox())!;
      const names = Object.keys(boxes);
      for (let i = 0; i < names.length; i++) {
        const a = boxes[names[i]];
        // inside the row, horizontally
        expect(a.x, `${names[i]} left edge`).toBeGreaterThanOrEqual(rowBox.x - 1);
        expect(a.x + a.width, `${names[i]} right edge`).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
        for (let j = i + 1; j < names.length; j++) {
          const c = boxes[names[j]];
          const overlapX = Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x);
          const overlapY = Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y);
          expect(overlapX > 1 && overlapY > 1, `${names[i]} overlaps ${names[j]}`).toBe(false);
        }
      }
      // the whole item name is on screen, not clipped by the row
      const nameText = row.getByText("Matcha Missionary Supreme Latte");
      const nameBox = (await nameText.boundingBox())!;
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      void testInfo;
    });
  }
});
