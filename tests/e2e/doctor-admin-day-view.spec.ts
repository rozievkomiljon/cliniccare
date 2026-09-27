import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "ChangeMe_2026!";
const ADMIN = { email: "admin@cliniccare.local", password: PASSWORD };
const NURSE = { email: "nurse@cliniccare.local", password: PASSWORD };
const DOCTOR_NAME = "Dr. Dana Doctor";

async function login(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

/**
 * A Saturday among the next five: the demo clinic works a short 09:00–13:00
 * shift that day and no other spec touches weekends, so the slot grid is
 * deterministic. Spreading across Saturdays keeps repeated local runs from
 * colliding in the reused E2E database.
 */
function randomSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * Math.floor(Math.random() * 5));
  return d.toISOString().slice(0, 10);
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const DOCTOR = { email: "doctor@cliniccare.local", password: PASSWORD };

test.describe("scheduling admin", () => {
  test("the day slot grid books a free slot with a prefilled time", async ({ page }) => {
    const date = randomSaturday();

    await login(page, ADMIN);
    await page.goto(`/appointments?view=day&date=${date}`);
    await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
    await expect(page.getByText(`${date} Sat`)).toBeVisible();

    // Free slots are buttons; booked ones are not.
    const freeSlots = page.locator('button[data-testid^="slot-"]');
    await expect(freeSlots.first()).toBeVisible({ timeout: 15_000 });
    const count = await freeSlots.count();
    const chosen = freeSlots.nth(Math.floor(Math.random() * count));
    const slotLabel = ((await chosen.getAttribute("data-testid")) ?? "").replace("slot-", "");
    expect(slotLabel).toMatch(/^\d{2}:\d{2}$/);

    // Picking a slot opens the booking form on exactly that clinic-local time.
    await chosen.click();
    await expect(page.getByLabel("Date and time")).toHaveValue(`${date}T${slotLabel}`);
    await page.getByLabel("Patient").selectOption({ label: "P-2026-00001 — Patient, Paul" });
    await page.getByLabel("Reason").fill("E2E slot grid visit");

    const booking = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.request().url().includes("/appointments"),
    );
    await page.getByRole("button", { name: "Book", exact: true }).click();
    const result = (await (await booking).json().catch(() => ({}))) as { ok?: boolean; error?: string };
    expect(result.ok, `slot booking failed: ${result.error ?? "no JSON body"}`).not.toBe(false);

    // The grid now shows the appointment in the slot that was free.
    await expect(page.locator(`div[data-testid="slot-${slotLabel}"]`)).toContainText("Paul Patient", {
      timeout: 15_000,
    });
  });

  test("an admin records and removes a doctor absence", async ({ page }) => {
    const date = daysAhead(30);

    await login(page, ADMIN);
    await page.goto("/doctors");
    await expect(page.getByRole("heading", { name: "Doctors" })).toBeVisible();

    await page.getByLabel(`Absence date for ${DOCTOR_NAME}`).fill(date);
    await page.getByLabel("Full day").check();
    await page.getByLabel(`Absence reason for ${DOCTOR_NAME}`).fill("E2E absence");
    await page.getByRole("button", { name: "Add absence" }).click();

    await expect(page.getByText(`${date} (all day)`).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: `Remove absence on ${date}` }).first().click();
    await expect(page.getByText(`${date} (all day)`)).toBeHidden({ timeout: 15_000 });
  });

  test("a nurse sees the doctor directory read-only", async ({ page }) => {
    await login(page, NURSE);
    await page.goto("/doctors");
    await expect(page.getByRole("heading", { name: "Doctors" })).toBeVisible();
    await expect(page.getByText(/Working hours:/).first()).toBeVisible();
    // schedule:manage is what unlocks the editors — a nurse only reads them.
    await expect(page.getByRole("button", { name: "Edit schedule" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add absence" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add doctor profile" })).toHaveCount(0);
  });

  test("free slots stay inert without appointments:manage", async ({ page }) => {
    await login(page, DOCTOR);
    await page.goto(`/appointments?view=day&date=${randomSaturday()}`);
    await expect(page.locator('div[data-testid^="slot-"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('button[data-testid^="slot-"]')).toHaveCount(0);
  });
});
