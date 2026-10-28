import type { Locator } from "@playwright/test";
import { autoAcceptDialogs, expect, goTab, openApp, readState, test } from "./support";
import { modal, openMenuEditor } from "./extra";

/** The "Uses milk?" / "Uses cream?" checkboxes and their default / allowed choices in the menu item editor. */
const box = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("input[type=checkbox]");
const select = (dlg: Locator, label: string) =>
  dlg.locator("div.space-y-1\\.5", { hasText: label }).locator("select");

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
