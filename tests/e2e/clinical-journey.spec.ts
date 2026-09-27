import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "ChangeMe_2026!";
const DOCTOR = { email: "doctor@cliniccare.local", password: PASSWORD };
const RECEPTIONIST = { email: "reception@cliniccare.local", password: PASSWORD };
const PATIENT = { email: "patient@cliniccare.local", password: PASSWORD };

async function login(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
}

/**
 * Opens the demo patient's chart. The registry is searched rather than paged
 * through (a reused E2E database accumulates journey patients, so the demo
 * record is not guaranteed to sit on the first page), and the profile is
 * opened by URL — the same way the patient journey spec reaches it.
 */
async function openPatientChart(page: Page): Promise<void> {
  await page.goto("/patients?q=P-2026-00001");
  const href = await page.getByRole("link", { name: "Patient, Paul" }).first().getAttribute("href");
  expect(href, "patient link missing from the registry").toBeTruthy();
  await page.goto(href!);
  await expect(page.getByRole("heading", { name: "Paul Patient" })).toBeVisible({ timeout: 15_000 });
}

/** Unique per run so a reused E2E database never hides the new assertions. */
function uniqueTag(): string {
  return Date.now().toString(36);
}

test.describe("clinical record journey", () => {
  test("a doctor writes, signs and annotates a visit; the patient sees it in the portal", async ({ page }) => {
    const tag = uniqueTag();
    const diagnosis = `E2E clinical record ${tag}`;

    // --- Doctor: open the record ---
    await login(page, DOCTOR);
    await openPatientChart(page);

    await page.getByRole("button", { name: "Start clinical record" }).click();
    await expect(page.getByLabel("Encounter date and time")).toBeVisible();
    await page.getByLabel("Encounter type").selectOption("FOLLOW_UP");
    await page.getByLabel("Chief complaint").fill("Cough for two weeks");
    const opened = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByRole("button", { name: "Open record" }).click();
    await opened;

    // The fresh record is the only draft on the chart.
    const draftRow = page.locator("li", { hasText: "draft" }).first();
    await expect(draftRow).toBeVisible({ timeout: 15_000 });
    await draftRow.getByRole("link", { name: "open record →" }).click();
    await expect(page.getByRole("heading", { name: /Clinical record ·/ })).toBeVisible();

    await page.getByLabel("Diagnosis").fill(diagnosis);
    await page.getByLabel("Plan").fill("Rest, fluids, review in one week.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible({ timeout: 15_000 });

    // --- Doctor: sign it (the draft form disappears) ---
    await page.getByRole("button", { name: "Sign record" }).click();
    await expect(page.getByText(/signed by/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
    await expect(page.getByText(diagnosis)).toBeVisible();

    // --- Doctor: corrections arrive as addenda, and vitals are observations ---
    // `exact` because "Note" also prefixes the note-kind select and vitals notes.
    await page.getByLabel("Note", { exact: true }).fill(`Addendum ${tag}: chest clear on auscultation.`);
    await page.getByRole("button", { name: "Add addendum" }).click();
    await expect(page.getByText(`Addendum ${tag}:`)).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Systolic").fill("137");
    await page.getByLabel("Diastolic").fill("88");
    await page.getByLabel("Pulse").fill("71");
    await page.getByRole("button", { name: "Record vitals" }).click();
    await expect(page.getByText(/BP 137\/88 mmHg/)).toBeVisible({ timeout: 15_000 });
    await logout(page);

    // --- Receptionist: the chart has no clinical surface at all ---
    await login(page, RECEPTIONIST);
    await openPatientChart(page);
    await expect(page.getByRole("heading", { name: "Clinical record" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start clinical record" })).toHaveCount(0);
    await expect(page.getByLabel("Systolic")).toHaveCount(0);
    await logout(page);

    // --- Patient: signed visits and vitals, nothing in between ---
    await login(page, PATIENT);
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "My visits" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(diagnosis)).toBeVisible();
    // Earlier runs recorded the same observation, so match the newest row.
    await expect(page.getByText(/BP 137\/88 mmHg/).first()).toBeVisible();
    await expect(page.getByText(`Addendum ${tag}:`)).toHaveCount(0);
  });
});
