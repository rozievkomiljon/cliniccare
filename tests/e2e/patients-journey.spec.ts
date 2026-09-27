import { expect, test, type Page } from "@playwright/test";

const RECEPTIONIST = { email: "reception@cliniccare.local", password: "ChangeMe_2026!" };

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST.email);
  await page.getByLabel("Password").fill(RECEPTIONIST.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test.describe("patient module journey", () => {
  test("receptionist registers a patient, views profile, manages documents", async ({ page }) => {
    await login(page);

    // Seeded registry renders
    await page.goto("/patients");
    await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();
    await expect(page.getByText("P-2026-00001")).toBeVisible();
    await expect(page.getByRole("link", { name: /Gonzalez, Maria/ })).toBeVisible();

    // Register a new patient
    await page.getByRole("button", { name: "Register patient" }).click();
    const unique = Date.now().toString().slice(-6);
    await page.getByLabel("First name").fill("Elena");
    await page.getByLabel("Last name").fill(`Journey${unique}`);
    await page.getByLabel("Date of birth").fill("1993-06-15");
    await page.getByLabel("Sex").selectOption("FEMALE");
    await page.getByLabel("Phone", { exact: true }).fill("+1 555 020 0001");
    await page.getByLabel("City").fill("Springfield");
    await page.getByLabel("Allergies").fill("Sulfa drugs");
    await page.getByRole("button", { name: "Register", exact: true }).click();

    // Redirected to the profile page with generated MRN
    await expect(page).toHaveURL(/\/patients\/[a-z0-9]+$/i, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Elena Journey/ })).toBeVisible();
    await expect(page.getByText(/^P-\d{4}-\d{5}$/).first()).toBeVisible();
    // Receptionists hold no clinical:view: the allergy must NOT be shown.
    await expect(page.getByText("Sulfa drugs")).toBeHidden();
    await expect(page.getByText("Clinical history is visible to clinical roles only.")).toBeVisible();
    const profileUrl = page.url();

    // Upload a document through the authorized handler
    await page.setInputFiles('input[type="file"]', {
      name: "referral-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Referral: orthopedics follow-up for Elena."),
    });
    await page.getByPlaceholder("Description (optional)").fill("Referral letter");
    const uploadResponse = page.waitForResponse(
      (r) => r.url().includes("/documents") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Upload" }).click();
    const upload = await uploadResponse;
    const uploadJson = (await upload.json()) as { ok: boolean; data?: { id: string } };
    expect(uploadJson.ok).toBe(true);
    await expect(page.getByRole("link", { name: "referral-note.txt" })).toBeVisible({ timeout: 15_000 });

    // Authorized download: bytes return through the app, storage stays private
    const patientId = profileUrl.split("/").pop();
    const download = await page.request.get(
      new URL(`/api/patients/${patientId}/documents/${uploadJson.data?.id}`, page.url()).toString(),
    );
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("text/plain");
    expect(await download.text()).toContain("orthopedics follow-up");

    // Search narrows the list
    await page.goto("/patients");
    await page.getByLabel("Search patients").fill(`Journey${unique}`);
    await expect(page.getByRole("link", { name: new RegExp(`Journey${unique}`) })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /Gonzalez, Maria/ })).toBeHidden();

    // A doctor (clinical:view) sees the medical history the receptionist could not.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await page.getByLabel("Email").fill("doctor@cliniccare.local");
    await page.getByLabel("Password").fill(RECEPTIONIST.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto(profileUrl);
    await expect(page.getByText("Sulfa drugs")).toBeVisible();
  });

  test("patient portal sees only own record", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("patient@cliniccare.local");
    await page.getByLabel("Password").fill(RECEPTIONIST.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto("/portal");
    await expect(page.getByText(/Welcome, Paul Patient/)).toBeVisible();

    // No staff patient registry access
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/forbidden\?.*permission=patients%3Aview/);
  });
});
