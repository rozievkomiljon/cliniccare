import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "ChangeMe_2026!";
const RECEPTIONIST = { email: "reception@cliniccare.local", password: PASSWORD };
const DOCTOR = { email: "doctor@cliniccare.local", password: PASSWORD };
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
 * Next business day at a random 10:xx–16:xx slot on :35–:55 (never colliding
 * with the seeded 10:00/11:00/14:00 demo appointments), plus the Sunday that
 * starts its calendar week for stable `?week=` navigation.
 */
function pickSlot(): { week: string; start: string; moved: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  const hour = 10 + Math.floor(Math.random() * 6);
  const minute = 35 + 5 * Math.floor(Math.random() * 4); // 35..50 so +5 stays inside the hour
  const weekStart = new Date(d);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    week: weekStart.toISOString().slice(0, 10),
    start: `${pad(hour)}:${pad(minute)}`,
    moved: `${pad(hour)}:${pad(minute + 5)}`,
  };
}

test.describe("appointment module journey", () => {
  test("receptionist books and reschedules; doctor sees own calendar; patient cancels and gets notified", async ({
    page,
  }) => {
    const slot = pickSlot();

    // The concrete next-business-day datetime to type into the booking form.
    const businessDay = new Date();
    businessDay.setUTCDate(businessDay.getUTCDate() + 1);
    while (businessDay.getUTCDay() === 0 || businessDay.getUTCDay() === 6)
      businessDay.setUTCDate(businessDay.getUTCDate() + 1);
    const startIso = `${businessDay.toISOString().slice(0, 10)}T${slot.start}`;
    const movedIso = `${businessDay.toISOString().slice(0, 10)}T${slot.moved}`;

    // --- Receptionist: book ---
    await login(page, RECEPTIONIST);
    await page.goto("/appointments");
    await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();

    await page.getByRole("button", { name: "Book appointment" }).click();
    await page.getByLabel("Doctor").selectOption({ label: "Dr. Dana Doctor — General Medicine" });
    await page.getByLabel("Patient").selectOption({ label: "P-2026-00001 — Patient, Paul" });
    await page.getByLabel("Date and time").fill(startIso);
    await page.getByLabel("Reason").fill("E2E journey visit");
    // The booking runs as a POST server action that can take a few seconds
    // (serializable transaction); await its response instead of racing it.
    const bookResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.request().url().includes("/appointments"),
    );
    await page.getByRole("button", { name: "Book", exact: true }).click();
    const bookResp = await bookResponse;
    // Response body can be unavailable for the action round-trip; the await
    // itself is the guarantee the server action (and its commit) finished.
    const bookResult = (await bookResp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    expect(bookResult.ok, `booking failed: ${bookResult.error ?? "no JSON body"}`).not.toBe(false);

    // The calendar (week of the booking) must show the new slot.
    await page.goto(`/appointments?week=${slot.week}`);
    const bookedCard = page.locator("li", { hasText: `${slot.start} · Paul Patient` });
    await expect(bookedCard).toBeVisible({ timeout: 15_000 });

    // --- Receptionist: reschedule from the detail page ---
    await bookedCard.getByRole("link", { name: "details" }).click();
    await expect(page.getByRole("heading", { name: /Paul Patient/ })).toBeVisible();
    await page.getByLabel("Move to date and time").fill(movedIso);
    const rescheduleResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.request().url().includes("/appointments/"),
    );
    await page.getByRole("button", { name: "Reschedule" }).click();
    const rescheduleResp = await rescheduleResponse;
    const rescheduleResult = (await rescheduleResp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    expect(rescheduleResult.ok, `reschedule failed: ${rescheduleResult.error ?? "no JSON body"}`).not.toBe(false);
    await expect(page.getByText(/RESCHEDULED/i).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/appointments?week=${slot.week}`);
    await expect(page.locator("li", { hasText: `${slot.moved} · Paul Patient` })).toBeVisible();
    await logout(page);

    // --- Doctor: own calendar shows the moved appointment ---
    await login(page, DOCTOR);
    await page.goto(`/appointments?week=${slot.week}`);
    await expect(page.locator("li", { hasText: `${slot.moved} · Paul Patient` })).toBeVisible();
    await logout(page);

    // --- Patient: portal scoping, cancel, notification ---
    await login(page, PATIENT);
    await page.goto("/appointments");
    await expect(page).toHaveURL(/\/forbidden\?.*permission=schedule%3Aview/);
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: /Welcome, Paul/ })).toBeVisible();

    const upcomingCard = page.locator("li", { hasText: `${slot.moved} UTC — Dr. Dana Doctor` });
    await expect(upcomingCard).toBeVisible();
    await upcomingCard.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Appointment cancelled.")).toBeVisible({ timeout: 15_000 });

    await page.goto("/notifications");
    await expect(page.getByText("Appointment cancelled").first()).toBeVisible();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByRole("button", { name: "Marking…" })).toBeHidden();
  });
});
