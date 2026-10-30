import type { Locator } from "@playwright/test";
import { autoAcceptDialogs, expect, goTab, openApp, readState, test } from "./support";
import { modal, openMenuEditor as openEditorOnCurrentTab } from "./extra";

/** The "Uses milk?" / "Uses cream?" checkboxes and their default / allowed choices in the menu item editor. */
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

test.describe("menu item editor: Uses milk? / Uses cream?", () => {
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

  test("a new item: both boxes can be ticked, a default is chosen, and it saves", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /New item/ }).click();
    const dlg = modal(page, /New menu item/);
    await dlg.locator("input").first().fill("Fresh drink");
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();
    await expect(box(dlg, "Uses cream?")).not.toBeChecked();

    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    await expect(select(dlg, "Default milk")).toBeEnabled();
    await box(dlg, "Uses cream?").click();
    await expect(box(dlg, "Uses cream?")).toBeChecked();
    await expect(select(dlg, "Default cream")).toBeEnabled();

    // the default can be changed; the choice sticks
    const milkOptions = await select(dlg, "Default milk").locator("option").allTextContents();
    expect(milkOptions.length).toBeGreaterThan(2);
    await select(dlg, "Default milk").selectOption({ index: 2 });
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    const saved = await item(page, "Fresh drink");
    expect(saved.defaultMilkId).toBeTruthy();
    expect(saved.allowedMilkIds.length).toBeGreaterThan(0);
    expect(saved.defaultCreamId).toBeTruthy();
    expect(saved.allowedCreamIds.length).toBeGreaterThan(0);

    // survives a reload
    await page.reload();
    const again = await item(page, "Fresh drink");
    expect(again.defaultMilkId).toBe(saved.defaultMilkId);
  });

  test("a pastry (no milk / cream) can have them switched on", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    const dlg = await openMenuEditor(page, "Matcha Cheesecake");
    await expect(box(dlg, "Uses milk?")).not.toBeChecked();
    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
  });
});

test.describe("milks and creams must be designated before menu items can offer them", () => {
  async function openIngredients(page: import("@playwright/test").Page) {
    await goTab(page, "Menu Manager");
    await page.getByRole("button", { name: /Ingredients/ }).first().click();
  }

  test("hand-made milk and cream (no pool): the boxes offer nothing; mark them (suggestion banner) and they work", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await openIngredients(page);

    // the user's situation: ingredients exist but none is marked as milk or cream
    const pools = page.getByLabel(/^Milk or cream for /);
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
    const cream = page.getByTestId("suggest-cream");
    await expect(cream).toContainText("Plain cream");
    await cream.getByRole("button", { name: "Mark as cream" }).click();
    await expect(page.getByTestId("suggest-cream")).toHaveCount(0);
    await expect(page.getByLabel("Milk or cream for Whole milk")).toHaveValue("milk");
    await expect(page.getByLabel("Milk or cream for Plain cream")).toHaveValue("cream");
    const marked = (await readState(page)).ingredients;
    expect(marked.find((i: any) => i.name === "Lactose-free milk").pool).toBe("milk");

    // now the boxes work, the dropdowns are filled with them, and the choice sticks through a reload
    dlg = await openMenuEditor(page, "Matcha Cheesecake"); // a pastry: no milk or cream configured
    await box(dlg, "Uses milk?").click();
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    const milkChoices = await select(dlg, "Default milk").locator("option").allTextContents();
    expect(milkChoices).toEqual(expect.arrayContaining(["Whole milk", "Lactose-free milk", "Oat milk"]));
    await select(dlg, "Default milk").selectOption({ label: "Lactose-free milk" });
    await box(dlg, "Uses cream?").click();
    await expect(box(dlg, "Uses cream?")).toBeChecked();
    expect(await select(dlg, "Default cream").locator("option").allTextContents()).toContain("Plain cream");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    await page.reload();
    const saved = await item(page, "Matcha Cheesecake");
    const lactose = (await readState(page)).ingredients.find((i: any) => i.name === "Lactose-free milk");
    expect(saved.defaultMilkId).toBe(lactose.id);
    expect(saved.allowedMilkIds.length).toBeGreaterThan(1);
    expect(saved.defaultCreamId).toBeTruthy();
    dlg = await openMenuEditor(page, "Matcha Cheesecake");
    await expect(box(dlg, "Uses milk?")).toBeChecked();
    await expect(select(dlg, "Default milk")).toHaveValue(lactose.id);
  });

  test("a new ingredient can be created already marked as milk or cream", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await openIngredients(page);
    await page.getByRole("button", { name: /New ingredient/ }).click();
    const form = modal(page, "New ingredient");
    await form.getByRole("textbox").first().fill("Soy drink");
    await form.locator("input[type=number]").nth(0).fill("4");
    await form.locator("input[type=number]").nth(1).fill("1000");
    await form.getByLabel("Milk or cream").selectOption("milk");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(form).toBeHidden();
    await expect(page.getByLabel("Milk or cream for Soy drink")).toHaveValue("milk");
    expect((await readState(page)).ingredients.find((i: any) => i.name === "Soy drink").pool).toBe("milk");
  });

  test("marking an ingredient that a recipe already uses does not change that drink's cost", async ({ page }) => {
    autoAcceptDialogs(page);
    await openApp(page);
    await openIngredients(page);
    const pools = page.getByLabel(/^Milk or cream for /);
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
    await page.getByLabel("Milk or cream for Whole milk").selectOption("milk");
    const after = await costOf();
    expect(after.m.defaultMilkId).toBe(after.ing.find((i: any) => i.name === "Whole milk").id);
    expect(after.m.allowedMilkIds).toContain(after.m.defaultMilkId);
    expect(before.m.ingredientLines).toEqual(after.m.ingredientLines); // recipe untouched
    void before;
  });
});

