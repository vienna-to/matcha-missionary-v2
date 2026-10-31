import type { Locator, Page } from "@playwright/test";
import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { baristaCard, modal } from "./extra";

/**
 * Custom / off-menu drink: bases (teas) and toppings from flagged ingredients,
 * milk added automatically, priced 6.70 + 0.20 per topping, costed with
 * packaging, and comboable ($10, +0.20 per topping beyond the first).
 */
const addBase = (dlg: Locator, name: string) => dlg.getByLabel("Add base").selectOption({ label: name });
const addTopping = (dlg: Locator, name: string) => dlg.getByLabel("Add topping").selectOption({ label: name });
const optionTexts = async (sel: Locator) => (await sel.locator("option").allTextContents()).map((t) => t.trim());
const openCustom = (page: Page) => page.locator("main header").getByRole("button", { name: "+ Custom drink" }).click();

test.describe("custom drink", () => {
  test("the Custom drink and Combo deal buttons are in the top row only, not in the cart panel", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Buttons once" });
    const top = page.locator("main header");
    await expect(top.getByRole("button", { name: "+ Custom drink" })).toHaveCount(1);
    await expect(top.getByRole("button", { name: /\+ Combo deal/ })).toHaveCount(1);
    // empty cart, then with an item: the side panel never offers them
    for (let step = 0; step < 2; step++) {
      await expect(page.locator("aside").getByRole("button", { name: /Custom drink|Combo deal/ })).toHaveCount(0);
      if (step === 0) await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
    }
    await expect(page.getByRole("button", { name: /Custom drink|Combo deal/ })).toHaveCount(2);
  });

  test("entry flow: dropdowns, price preview, cost preview, order, totals", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom entry" });

    await openCustom(page);
    const dlg = modal(page, "Custom drink");
    await expect(dlg.getByRole("button", { name: "Add custom drink" })).toBeDisabled();
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.70");

    // only teas (+ Milk only) and toppings: never milk, cups, agave or ice
    expect(await optionTexts(dlg.getByLabel("Add base"))).toEqual([
      "Add a base…", "Earl Grey leaves", "Hojicha powder", "Matcha powder", "Milk only",
    ]);
    const toppings = await optionTexts(dlg.getByLabel("Add topping"));
    expect(toppings).toContain("Banana cream");
    expect(toppings).toContain("Strawberry purée");
    for (const bad of ["Whole milk", "Agave", "16oz cup", "Ice", "Lid", "Matcha powder"]) expect(toppings).not.toContain(bad);

    await addBase(dlg, "Hojicha powder");
    // 4g hojicha + standard milk + packaging, every amount from the seed recipes
    await expect(dlg.getByTestId("custom-cost")).toContainText("$2.08");
    await addBase(dlg, "Matcha powder"); // 2 teas: the tea amount is split, milk stays full
    await addTopping(dlg, "Banana cream");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
    await addTopping(dlg, "Strawberry purée");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$7.10"); // 2 bases + 2 toppings
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await expect(dlg).toBeHidden();

    const line = page.locator("aside").locator("div.rounded-xl", { hasText: "Custom:" }).first();
    await expect(line).toContainText("Hojicha powder");
    await expect(line).toContainText("Banana cream");
    await expect(line).toContainText("Whole milk"); // the automatic milk shows like a menu drink's
    await expect(line).toContainText("$7.10");

    await placeOrder(page, { items: [], name: "Custom Cam", pay: "Cash" });

    const item = (await readState(page)).orders.at(-1).items[0];
    expect(item.menuItemNameSnap).toBe("Custom: Hojicha powder + Matcha powder + Banana cream + Strawberry purée");
    expect(item.priceSnap).toBe(7.1);
    expect(item.costSnap).toBeGreaterThan(2.5); // includes milk and packaging, not just components
    expect(item.milkNameSnap).toBe("Whole milk");

    await goTab(page, "Barista Queue");
    await expect(page.locator("main")).toContainText("Custom: Hojicha powder");
    await goTab(page, "Event Summary");
    const main = page.locator("main");
    await expect(main).toContainText("Revenue (paid)");
    await expect(main).toContainText("$7.10");
    await expect(main).toContainText("Custom: Hojicha powder");
  });

  test("milk only is the no-tea base and excludes teas", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom milk" });
    await openCustom(page);
    const dlg = modal(page, "Custom drink");
    await addBase(dlg, "Hojicha powder");
    await addBase(dlg, "Milk only"); // replaces the tea
    await expect(dlg.getByRole("button", { name: "Remove Hojicha powder" })).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: "Remove Milk only" })).toBeVisible();
    await addTopping(dlg, "Banana cream");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await placeOrder(page, { items: [], name: "Milky", pay: "Cash" });
    const item = (await readState(page)).orders.at(-1).items[0];
    expect(item.menuItemNameSnap).toBe("Custom: Milk + Banana cream");
    expect(item.priceSnap).toBe(6.9);
  });

  test("the dropdowns follow the flag set in Menu Manager", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom flags" });
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
    // hide a tea, and offer an ingredient the old name guess never would
    await page.getByLabel("Custom drink role for Earl Grey leaves").selectOption("none");
    await page.getByLabel("Custom drink role for Dubai chocolate spread").selectOption("topping");
    const stored = (await readState(page)).ingredients;
    expect(stored.find((i: any) => i.name === "Earl Grey leaves").customRole).toBe("none");

    await goTab(page, "Live Orders");
    await openCustom(page);
    const dlg = modal(page, "Custom drink");
    expect(await optionTexts(dlg.getByLabel("Add base"))).not.toContain("Earl Grey leaves");
    expect(await optionTexts(dlg.getByLabel("Add topping"))).toContain("Dubai chocolate spread");
  });

  test("a custom drink in a combo: $10, +0.20 per topping beyond the first", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom combo" });
    await page.locator("main header").getByRole("button", { name: /Combo deal/ }).click();
    const dlg = modal(page, /Combo deal/);
    await dlg.getByRole("combobox").first().selectOption({ label: "CUSTOM DRINK…" });
    await addBase(dlg, "Hojicha powder");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$10.00");
    await addTopping(dlg, "Banana cream");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$10.00"); // one topping is covered
    await addTopping(dlg, "Strawberry purée");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$10.20");
    await addTopping(dlg, "Ube cream");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$10.40");
    await dlg.getByRole("button", { name: "Add combo" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.locator("aside").locator("div.rounded-xl", { hasText: "Combo:" }).first()).toContainText("$10.40");

    await placeOrder(page, { items: [], name: "Combo Cam", pay: "Cash" });
    const item = (await readState(page)).orders.at(-1).items[0];
    expect(item.isCombo).toBe(true);
    expect(item.priceSnap).toBe(10.4);
    expect(item.menuItemNameSnap).toContain("Custom: Hojicha powder");
    expect(item.costSnap).toBeGreaterThan(3); // custom drink (with milk + packaging) + pastry
  });

  test("edit flow: add a custom drink to an existing order", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "Custom edit" });
    await placeOrder(page, { items: [{ name: "Classic Matcha" }], name: "Editor", pay: "Cash", declineCombo: true });
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const edit = modal(page, /Edit order #1/);
    await edit.getByRole("button", { name: /Add item/ }).click();
    await modal(page, "Add item").getByRole("button", { name: /Custom drink/ }).click();

    const dlg = modal(page, "Custom drink");
    await addBase(dlg, "Hojicha powder");
    await addTopping(dlg, "Banana cream");
    await expect(dlg.getByTestId("custom-price")).toHaveText("$6.90");
    await dlg.getByRole("button", { name: "Add custom drink" }).click();
    await expect(edit).toContainText("Custom: Hojicha powder + Banana cream");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();

    const items = (await readState(page)).orders.at(-1).items;
    expect(items).toHaveLength(2);
    const custom = items.find((i: any) => i.menuItemNameSnap.startsWith("Custom:"));
    expect(custom.priceSnap).toBe(6.9);
    expect(custom.costSnap).toBeGreaterThan(2);
    expect(items.find((i: any) => i.menuItemNameSnap === "Classic Matcha").priceSnap).toBe(6.7);
  });

  test("a base is required", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Custom guard" });
    await openCustom(page);
    const dlg = modal(page, "Custom drink");
    await addTopping(dlg, "Banana cream");
    await expect(dlg.getByRole("button", { name: "Add custom drink" })).toBeDisabled();
    await expect(dlg.getByRole("alert")).toContainText("at least one base");
  });
});
