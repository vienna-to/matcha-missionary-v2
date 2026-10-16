import { expect, type Locator, type Page } from "@playwright/test";
import { field, goTab, readState } from "./support";

// ---- extra helpers used by the edge-case specs -------------------------------

export async function eventOrders(page: Page, eventName: string) {
  const st = await readState(page);
  const ev = st.events.find((e: { name: string }) => e.name === eventName);
  return {
    event: ev,
    orders: st.orders
      .filter((o: { eventId: string }) => o.eventId === ev?.id)
      .sort((a: { orderNumber: number }, b: { orderNumber: number }) => a.orderNumber - b.orderNumber),
    state: st,
  };
}

/** Modal rendered by ui.tsx#Modal, found by its heading text. */
export function modal(page: Page, title: string | RegExp): Locator {
  return page.locator("div.fixed.inset-0", { has: page.getByRole("heading", { name: title }) });
}

function menuCard(page: Page, itemName: string): Locator {
  return page
    .locator("main div.rounded-2xl")
    .filter({ has: page.locator("div.t-display", { hasText: new RegExp(`^${itemName}$`) }) })
    .first();
}

export async function openMenuEditor(page: Page, itemName: string) {
  await goTab(page, "Menu Manager");
  await menuCard(page, itemName).locator("button:has(svg.lucide-pencil)").click();
  return modal(page, /Edit menu item/);
}

export async function setMenuPrice(page: Page, itemName: string, price: number) {
  const dlg = await openMenuEditor(page, itemName);
  await field(dlg, "Price ($)").fill(String(price));
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
}

export async function archiveMenuItem(page: Page, itemName: string) {
  await goTab(page, "Menu Manager");
  await menuCard(page, itemName).locator('button[title="Archive"]').click();
}

export async function addMenuItem(page: Page, name: string, price: number) {
  await goTab(page, "Menu Manager");
  await page.getByRole("button", { name: /New item/ }).click();
  const dlg = modal(page, /New menu item/);
  await field(dlg, "Name").fill(name);
  await field(dlg, "Price ($)").fill(String(price));
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
}

/** The header row of one barista card: holds the #N, Start/Mark buttons, Edit and Remove. */
export function baristaCard(page: Page, n: number): Locator {
  return page
    .locator("div.text-2xl", { hasText: new RegExp(`^#${n}$`) })
    .first()
    .locator("xpath=ancestor::div[.//button[@title='Edit']][1]");
}
