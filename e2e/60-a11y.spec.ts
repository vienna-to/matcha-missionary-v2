import { createEvent, expect, openApp, test } from "./support";

test.describe("accessibility markup (QA-9, fixed)", () => {
  test("dialogs have a role and an accessible name; labels are tied to their inputs", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /new event/i }).first().click();
    const dlg = page.getByRole("dialog", { name: "New event" });
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute("aria-modal", "true");
    await dlg.getByLabel("Event name").fill("A11y Popup");
    await expect(dlg.getByLabel("Event name")).toHaveValue("A11y Popup");
    await dlg.getByLabel("Start time").fill("10:00");
    await dlg.getByLabel("Cup size (oz)").fill("12");
    await expect(dlg.getByLabel("Event type")).toBeVisible(); // select
    await dlg.getByRole("button", { name: "Create event" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("menu editor fields are reachable by label", async ({ page }) => {
    await openApp(page);
    await createEvent(page, { name: "Labels" });
    await page.locator("aside nav").getByRole("button", { name: "Menu Manager" }).click();
    await page.locator("main button:has(svg.lucide-pencil)").first().click();
    const dlg = page.getByRole("dialog", { name: /Edit menu item/ });
    await expect(dlg.getByLabel("Name")).toBeVisible();
    await expect(dlg.getByLabel("Price ($)")).toBeVisible();
    await expect(dlg.getByLabel("Description")).toBeVisible();
  });

  test.describe("phone order sheet", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("the bottom sheet is a named dialog", async ({ page }) => {
      await page.goto("/");
      await page.locator("main").getByRole("button", { name: /^Classic Matcha/ }).first().click();
      await page.getByRole("button", { name: /Review order/ }).click();
      await expect(page.getByRole("dialog", { name: "Current order" })).toBeVisible();
    });
  });
});
