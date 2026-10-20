import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, test } from "./support";
import { baristaCard, eventOrders, modal } from "./extra";

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
