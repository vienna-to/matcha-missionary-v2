import { createEvent, expect, goTab, openApp, test } from "./support";
import { eventOrders } from "./extra";

test.describe("combo deal and phone booth flow", () => {
  test("drink + pastry offers the combo; accepting prices the pair at $10 with summed cost", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Combo" });
    const main = page.locator("main");
    await main.getByRole("button", { name: /^Classic Matcha/ }).first().click();
    await main.getByRole("button", { name: /^Matcha Cheesecake/ }).first().click();
    await page.locator("aside ol").getByRole("button", { name: /Name/ }).click();
    await expect(page.getByRole("heading", { name: "Make it a combo?" })).toBeVisible();
    await page.getByRole("button", { name: "Make it a combo" }).first().click();
    await page.getByPlaceholder("who's it for?").fill("Combo Kid");
    await page.locator("aside ol").getByRole("button", { name: /Payment/ }).click();
    await page.locator("aside").last().getByRole("button", { name: "Venmo", exact: true }).click();
    await page.locator("aside").last().getByRole("button", { name: /Confirm order/ }).click();
    const { orders } = await eventOrders(page, "Combo");
    expect(orders).toHaveLength(1);
    expect(orders[0].items).toHaveLength(1);
    expect(orders[0].items[0].isCombo).toBe(true);
    expect(orders[0].items[0].priceSnap).toBe(10);
    expect(orders[0].items[0].costSnap).toBeCloseTo(2.2342 + 0.8, 3);
    await goTab(page, "Event Summary");
    await expect(page.locator("main").locator("dl > div").filter({ hasText: "Sales revenue" }).first()).toContainText("$10.00");
  });
});

test.describe("phone (390px) bottom-sheet flow", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("create event, take an order through the sheet, see it in the barista queue", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Live Orders" })).toBeVisible();
    await page.getByRole("button", { name: "New event" }).click();
    const dlg = page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: "New event" }) });
    await dlg.locator("input").first().fill("Phone Popup");
    await dlg.getByRole("button", { name: "Create event" }).click();
    await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
    await page.getByRole("button", { name: /Review order/ }).click();
    const sheetTabs = page.locator("ol").first();
    await expect(sheetTabs.getByRole("button", { name: /Adjustments/ })).toBeVisible();
    await sheetTabs.getByRole("button", { name: /Name/ }).click();
    await page.getByPlaceholder("who's it for?").fill("Mobile Mo");
    await sheetTabs.getByRole("button", { name: /Payment/ }).click();
    await page.getByRole("button", { name: "Zelle", exact: true }).click();
    await page.getByRole("button", { name: /Confirm order/ }).click();
    await expect(page.getByRole("status")).toContainText("Mobile Mo");
    await page.locator("nav.fixed").getByRole("button", { name: /Barista/ }).click();
    await expect(page.getByText("1 active · 0 completed")).toBeVisible();
    // no horizontal overflow on this phone page
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
