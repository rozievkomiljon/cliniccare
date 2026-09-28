import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "ChangeMe_2026!";
const DOCTOR = { email: "doctor@cliniccare.local", password: PASSWORD };
const LAB = { email: "lab@cliniccare.local", password: PASSWORD };
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
 * Opens the demo patient's chart by searching the registry — a reused E2E
 * database accumulates journey patients, so the demo record is not guaranteed to
 * sit on the first page.
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

test.describe("laboratory journey", () => {
  test("a doctor orders, the bench reports and the patient sees the released result", async ({ page }) => {
    const tag = uniqueTag();
    const indication = `E2E lab ${tag}`;
    const result = "11.7";

    // --- Doctor: raise the request from the chart ---
    await login(page, DOCTOR);
    await openPatientChart(page);

    await page.getByRole("button", { name: "Order lab tests" }).click();
    await page.getByLabel("Haemoglobin").check();
    await page.getByLabel("Priority").selectOption("URGENT");
    await page.getByLabel("Indication").fill(indication);
    await page.getByRole("button", { name: "Place order" }).click();

    // The form closes on success, so the new request on the chart is the proof.
    const chartCard = page.getByTestId("lab-order-card").filter({ hasText: indication });
    await expect(chartCard).toBeVisible({ timeout: 15_000 });
    await expect(chartCard.getByText("awaiting collection")).toBeVisible();
    await logout(page);

    // --- Bench: collect the sample, then report the result ---
    await login(page, LAB);
    await page.getByRole("link", { name: "Lab queue" }).click();
    await expect(page.getByRole("heading", { name: "Laboratory" })).toBeVisible({ timeout: 15_000 });

    const queued = page.getByTestId("lab-order-card").filter({ hasText: indication });
    await expect(queued.getByText("awaiting collection")).toBeVisible();
    await queued.getByRole("button", { name: "Mark sample collected" }).click();
    await expect(queued.getByText("in the lab")).toBeVisible({ timeout: 15_000 });

    await queued.getByLabel("Haemoglobin result").fill(result);
    await queued.getByLabel("Haemoglobin flag").selectOption("LOW");
    await queued.getByRole("button", { name: "Save results" }).click();
    await expect(queued.getByText("awaiting verification")).toBeVisible({ timeout: 15_000 });
    await logout(page);

    // --- Doctor: release the result ---
    await login(page, DOCTOR);
    await page.goto("/laboratory");
    const pending = page.getByTestId("lab-order-card").filter({ hasText: indication });
    await pending.getByRole("button", { name: "Verify results" }).click();
    // A released request leaves the bench queue…
    await expect(pending).toHaveCount(0, { timeout: 15_000 });
    // …and the chart marks it released.
    await openPatientChart(page);
    await expect(
      page.getByTestId("lab-order-card").filter({ hasText: indication }).getByText("verified", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await logout(page);

    // --- Receptionist: no laboratory surface at all ---
    await login(page, RECEPTIONIST);
    await expect(page.getByRole("link", { name: "Laboratory" })).toHaveCount(0);
    await page.goto("/laboratory");
    await expect(page).toHaveURL(/\/forbidden/, { timeout: 15_000 });
    // /forbidden renders outside the app shell (no sign-out button), so step
    // back to the dashboard before logging out.
    await page.goto("/dashboard");
    await logout(page);

    // --- Patient: the released result is theirs to read ---
    await login(page, PATIENT);
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "My lab results" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Haemoglobin").first()).toBeVisible();
    await expect(page.getByText(result).first()).toBeVisible();
    // The ordering indication stays with the care team.
    await expect(page.getByText(indication)).toHaveCount(0);
  });
});
