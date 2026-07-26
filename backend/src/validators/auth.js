import { z } from "zod";

// Zod schemas validate request bodies before they reach the service layer.
// This keeps validation logic out of the route handler and the service.
// Error messages are user-facing (not raw stack traces).

export const signupSchema = z.object({
  email: z
    .string()
    .email("Please provide a valid email address")
    .max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  name: z
    .string()
    .min(1, "Name is required")
    .max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z
    .string()
    .length(6, "OTP must be exactly 6 digits")
    .regex(/^\d{6}$/, "OTP must be numeric"),
});
