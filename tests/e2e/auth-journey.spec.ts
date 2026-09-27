import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "ChangeMe_2026!";
const RECEPTIONIST = { email: "reception@cliniccare.local", password: PASSWORD };
const DOCTOR = { email: "doctor@cliniccare.local", password: PASSWORD };
const CLINIC_ADMIN = { email: "admin@cliniccare.local", password: PASSWORD };
const PATIENT = { email: "patient@cliniccare.local", password: PASSWORD };

async function login(
  page: Page,
  creds: { email: string; password: string },
  expectedHeading: RegExp,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(expectedHeading);
  await expect(page.getByText(`Signed in as ${creds.email}`)).toBeVisible();
}

async function expectForbidden(page: Page, path: string, permission: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`/forbidden\\?.*permission=${permission.replace(":", "%3A")}`));
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByText(`missing permission: ${permission}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to dashboard" })).toBeVisible();
}

test.describe("login journey", () => {
  test("receptionist lands on front-desk dashboard; forbidden routes reject", async ({ page }) => {
    await login(page, RECEPTIONIST, /Front desk/);
    await expectForbidden(page, "/settings/staff", "staff:manage");
    await expectForbidden(page, "/settings/audit", "audit:view");
    await expectForbidden(page, "/laboratory", "lab:collect");
    await expectForbidden(page, "/pharmacy", "pharmacy:catalog");
    // Receptionists DO hold billing permissions (front-desk payments):
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  });

  test("doctor lands on doctor dashboard; admin-only routes reject", async ({ page }) => {
    await login(page, DOCTOR, /Good day, Doctor/);
    await expectForbidden(page, "/settings/staff", "staff:manage");
    await expectForbidden(page, "/billing", "billing:view");
  });

  test("clinic admin reaches staff and audit pages", async ({ page }) => {
    await login(page, CLINIC_ADMIN, /Clinic overview/);
    await page.goto("/settings/staff");
    await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
    await page.goto("/settings/audit");
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    // Clinic admins are still not clinical users:
    await expectForbidden(page, "/laboratory", "lab:collect");
  });

  test("patient reaches portal-scoped dashboard but not staff areas", async ({ page }) => {
    await login(page, PATIENT, /Welcome/);
    await expectForbidden(page, "/settings/staff", "staff:manage");
    await expectForbidden(page, "/patients", "patients:view");
  });
});

test.describe("session security", () => {
  test("wrong password shows a generic error and stays on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(RECEPTIONIST.email);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated dashboard access redirects to login with callback", async ({ page }) => {
    await page.goto("/settings/staff");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings%2Fstaff/);
  });

  test("logout revokes the session server-side; replaying the cookie fails", async ({
    page,
    context,
  }) => {
    await login(page, RECEPTIONIST, /Front desk/);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("session-token"));
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // Replay the (now revoked) session token: the server must reject it.
    if (sessionCookie) {
      await context.addCookies([
        {
          name: sessionCookie.name,
          value: sessionCookie.value,
          domain: sessionCookie.domain,
          path: sessionCookie.path,
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
