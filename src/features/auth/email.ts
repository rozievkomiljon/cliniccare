/**
 * Auth email sending via raw SMTP (nodemailer). Dev default is the MailHog
 * container from docker/compose.yml. Policy: emails contain generic text and
 * links only — never diagnoses, credentials, or other PHI. The production
 * provider (Resend/SES) plugs in here behind the same functions.
 */
import nodemailer from "nodemailer";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      secure: env.MAIL_SECURE,
    });
  }
  return transporter;
}

const FROM = "ClinicCare <no-reply@cliniccare.local>";

function appUrl(path: string, token: string): string {
  return `${env.APP_URL}${path}?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = appUrl("/reset-password", token);
  try {
    await getTransporter().sendMail({
      from: FROM,
      to,
      subject: "Reset your ClinicCare password",
      text:
        `You requested a password reset for your ClinicCare account.\n\n` +
        `Open this link to choose a new password (valid for 1 hour):\n${url}\n\n` +
        `If you did not request this, you can safely ignore this email.`,
    });
  } catch (err) {
    // Email delivery must not fail the request flow; the token remains valid
    // and ops can re-send. Logged for alerting.
    logger.error({ err }, "failed to send password reset email");
  }
}

export async function sendEmailVerificationEmail(to: string, token: string): Promise<void> {
  const url = appUrl("/verify-email", token);
  try {
    await getTransporter().sendMail({
      from: FROM,
      to,
      subject: "Verify your ClinicCare email",
      text:
        `Welcome to ClinicCare!\n\n` +
        `Confirm your email address (valid for 24 hours):\n${url}\n\n` +
        `If you did not create an account, you can ignore this email.`,
    });
  } catch (err) {
    logger.error({ err }, "failed to send verification email");
  }
}
