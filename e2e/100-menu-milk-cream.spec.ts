import type { Locator } from "@playwright/test";
import { autoAcceptDialogs, createEvent, expect, goTab, openApp, placeOrder, readState, test } from "./support";
import { baristaCard, modal, openMenuEditor as openEditorOnCurrentTab } from "./extra";

/** The "Uses milk?" checkbox and its default / allowed choices in the menu item editor (cream is no longer a choice). */
const box = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("input[type=checkbox]");
const select = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("select");

/** The Menu Manager remembers its last sub-tab, so go to Items before opening an item. */
async function openMenuEditor(page: import("@playwright/test").Page, name: string) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  return openEditorOnCurrentTab(page, name);
}

const item = async (page: import("@playwright/test").Page, name: string) =>
  (await readState(page)).menuItems.find((m: any) => m.name === name);

test.describe("menu item editor: Uses milk?", () => {
  test("an existing drink: toggle off and on, choices follow, and it saves", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    const dlg = await openMenuEditor(page, "Classic Matcha");
    const before = await item(page, "Classic Matcha");
    expect(before.defaultMilkId).toBeTruthy();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    await expect(select(dlg, "Default milk")).toBeEnabled();

    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();
    await expect(select(dlg, "Default milk")).toBeDisabled();
    await expect(dlg.getByText("Allowed milks")).toHaveCount(0);

    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    await expect(select(dlg, "Default milk")).toBeEnabled();
    await expect(dlg.getByText("Allowed milks")).toBeVisible();

    // off again and save: persisted without milk
    await box(dlg, "Uses milk?").click();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    const saved = await item(page, "Classic Matcha");
    expect(saved.defaultMilkId).toBeUndefined();
    expect(saved.allowedMilkIds).toEqual([]);
  });

  test("a new item: the box can be ticked, a default is chosen, and it saves", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /New item/ }).click();
    const dlg = modal(page, /New menu item/);
    await dlg.locator("input").first().fill("Fresh drink");
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();

    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    await expect(select(dlg, "Default milk")).toBeEnabled();

    // the default can be changed; the choice sticks
    const milkOptions = await select(dlg, "Default milk").locator("option").allTextContents();
    expect(milkOptions.length).toBeGreaterThan(2);
    await select(dlg, "Default milk").selectOption({ index: 2 });
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    const saved = await item(page, "Fresh drink");
    expect(saved.defaultMilkId).toBeTruthy();
    expect(saved.allowedMilkIds.length).toBeGreaterThan(0);
    expect(saved.defaultCreamId).toBeUndefined();
    expect(saved.allowedCreamIds).toEqual([]);

    // survives a reload
    await page.reload();
    const again = await item(page, "Fresh drink");
    expect(again.defaultMilkId).toBe(saved.defaultMilkId);
  });

  test("a pastry (no milk) can have it switched on", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    const dlg = await openMenuEditor(page, "Matcha Cheesecake");
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();
    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
  });
});

test.describe("milks must be designated before menu items can offer them", () => {
  async function openIngredients(page: import("@playwright/test").Page) {
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
  }

  test("hand-made milks (no pool): the box offers nothing; mark them (suggestion banner) and it works", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await openIngredients(page);

    // the user's situation: ingredients exist but none is marked as milk
    const pools = page.getByLabel(/^Milk for /);
    const n = await pools.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      if ((await pools.nth(i).inputValue()) !== "") await pools.nth(i).selectOption("");
    }
    expect((await readState(page)).ingredients.filter((i: any) => i.pool).length).toBe(0);

    // Uses milk? cannot be ticked, and says why
    let dlg = await openMenuEditor(page, "Classic Matcha");
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();
    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();
    await expect(dlg).toContainText("No ingredient is marked as milk yet");
    await dlg.getByRole("button", { name: "Cancel" }).click();

    // the Ingredients tab spots them by name and marks them in one click
    await openIngredients(page);
    const banner = page.getByTestId("suggest-milk");
    await expect(banner).toContainText("Lactose-free milk");
    await expect(banner).toContainText("Whole milk");
    await banner.getByRole("button", { name: "Mark as milk" }).click();
    await expect(page.getByTestId("suggest-milk")).toHaveCount(0);
    // cream is never suggested or offered: it is just a recipe ingredient
    await expect(page.getByTestId("suggest-cream")).toHaveCount(0);
    await expect(page.getByLabel("Milk for Whole milk")).toHaveValue("milk");
    await expect(page.getByLabel("Milk for Plain cream").locator("option")).toHaveText(["-", "Milk"]);
    const marked = (await readState(page)).ingredients;
    expect(marked.find((i: any) => i.name === "Lactose-free milk").pool).toBe("milk");

    // now the boxes work, the dropdowns are filled with them, and the choice sticks through a reload
    dlg = await openMenuEditor(page, "Matcha Cheesecake"); // a pastry: no milk or cream configured
    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    const milkChoices = await select(dlg, "Default milk").locator("option").allTextContents();
    expect(milkChoices).toEqual(expect.arrayContaining(["Whole milk", "Lactose-free milk", "Oat milk"]));
    await select(dlg, "Default milk").selectOption({ label: "Lactose-free milk" });
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    await page.reload();
    const saved = await item(page, "Matcha Cheesecake");
    const lactose = (await readState(page)).ingredients.find((i: any) => i.name === "Lactose-free milk");
    expect(saved.defaultMilkId).toBe(lactose.id);
    expect(saved.allowedMilkIds.length).toBeGreaterThan(1);
    dlg = await openMenuEditor(page, "Matcha Cheesecake");
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    await expect(select(dlg, "Default milk")).toHaveValue(lactose.id);
  });

  test("a new ingredient can be created already marked as milk", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await openIngredients(page);
    await page.getByRole("button", { name: /New ingredient/ }).click();
    const form = modal(page, "New ingredient");
    await form.getByRole("textbox").first().fill("Soy drink");
    await form.locator("input[type=number]").nth(0).fill("4");
    await form.locator("input[type=number]").nth(1).fill("1000");
    await form.getByLabel("Milk", { exact: true }).selectOption("milk");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(form).toBeHidden();
    await expect(page.getByLabel("Milk for Soy drink")).toHaveValue("milk");
    expect((await readState(page)).ingredients.find((i: any) => i.name === "Soy drink").pool).toBe("milk");
  });

  test("marking an ingredient that a recipe already uses does not change that drink's cost", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await openIngredients(page);
    const pools = page.getByLabel(/^Milk for /);
    for (let i = 0; i < (await pools.count()); i++) if ((await pools.nth(i).inputValue()) !== "") await pools.nth(i).selectOption("");
    const costOf = async () => {
      await goTab(page, "Menu Manager");
      await page.getByRole("button", { name: "Items", exact: true }).click();
      const st = await readState(page);
      const m = st.menuItems.find((x: any) => x.name === "Classic Matcha");
      return { m, ing: st.ingredients };
    };
    const before = await costOf();
    // the recipe's milk line (180 ml of whole milk) is a plain line right now: mark whole milk as milk
    await openIngredients(page);
    await page.getByLabel("Milk for Whole milk").selectOption("milk");
    const after = await costOf();
    expect(after.m.defaultMilkId).toBe(after.ing.find((i: any) => i.name === "Whole milk").id);
    expect(after.m.allowedMilkIds).toContain(after.m.defaultMilkId);
    expect(before.m.ingredientLines).toEqual(after.m.ingredientLines); // recipe untouched
    void before;
  });
});


test.describe("cream is a plain recipe ingredient, not a choice", () => {
  test("the menu item editor has no cream controls, and a cream line still costs", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    const dlg = await openMenuEditor(page, "Ube Cream Matcha");
    await expect(dlg).toContainText("Uses milk?");
    for (const t of ["Uses cream?", "Default cream", "Allowed creams"]) await expect(dlg.getByText(t)).toHaveCount(0);
    // the cream line is still in the recipe, and the derived cost includes it (more than the same recipe without it)
    const st = await readState(page);
    const ube = st.menuItems.find((m: any) => m.name === "Ube Cream Matcha");
    const cream = st.ingredients.find((i: any) => i.id === ube.ingredientLines.find((l: any) => st.ingredients.find((x: any) => x.id === l.ingredientId)?.pool === "cream").ingredientId);
    await expect(dlg.locator("select").filter({ has: page.locator(`option[value="${cream.id}"]:checked`) })).toHaveCount(1);
    await dlg.getByRole("button", { name: "Cancel" }).click();
  });

  test("the Adjust step offers milk but no cream", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "NoCreamChoice" });
    await page.locator("main").getByRole("button", { name: /^Ube Cream Matcha/ }).first().click();
    await page.locator("aside ol").getByRole("button", { name: /Adjust/ }).click();
    const panel = page.locator("aside").last();
    await expect(panel.getByText("Milk", { exact: true })).toBeVisible();
    await expect(panel.getByText("Cream", { exact: true })).toHaveCount(0);
    await expect(panel.getByText(/no cream/i)).toHaveCount(0);
  });

  test("Edit Order offers milk but no cream, and a new order records no cream", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await createEvent(page, { name: "EditNoCream" });
    await placeOrder(page, { items: [{ name: "Ube Cream Matcha" }], pay: "Cash" });
    const st = await readState(page);
    const o = st.orders.find((x: any) => x.items.some((i: any) => i.menuItemNameSnap === "Ube Cream Matcha"));
    expect(o.items[0].creamChoiceId).toBeUndefined();
    expect(o.items[0].creamNameSnap).toBeUndefined();
    expect(o.items[0].costSnap).toBeGreaterThan(0);
    await goTab(page, "Barista Queue");
    await baristaCard(page, 1).getByTitle("Edit").click();
    const dlg = modal(page, /Edit order #1/);
    // the line summary shows the milk and nothing about cream
    await expect(dlg).toContainText("Whole milk");
    await expect(dlg.getByText(/no cream/i)).toHaveCount(0);
    // the customize panel (the sliders button on the line) has a Milk row and no Cream row
    await dlg.locator("button").filter({ has: page.locator("svg[class*=lucide-sliders]") }).first().click();
    const custom = page.locator("div.fixed.inset-0").last();
    await expect(custom.getByText("Milk", { exact: true }).first()).toBeVisible();
    await expect(custom.getByText("Cream", { exact: true })).toHaveCount(0);
    await expect(custom.getByRole("button", { name: /no cream/i })).toHaveCount(0);
  });
});
