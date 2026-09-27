import { z } from "zod";

export const AUTH_ERRORS = {
  invalid: "Invalid email or password.",
  disabled: "This account is disabled. Contact your clinic administrator.",
} as const;

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email.").max(255),
  password: z.string().min(1, "Password is required.").max(200),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email.").max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10).max(200),
});
