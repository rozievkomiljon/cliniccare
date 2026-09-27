/**
 * Auth.js v5 with JWT sessions + database-backed revocation.
 *
 * Auth.js does NOT support the credentials provider with the database-session
 * strategy (UnsupportedStrategy at runtime), so sessions are stateless JWTs in
 * an httpOnly SameSite=Lax cookie. Revocability is preserved by stamping each
 * token with its issue time and revalidating it against User.sessionsRevokedAt
 * on every request in src/lib/rbac/guard.ts — password reset and a future
 * "sign out everywhere" flip that stamp, invalidating every issued token.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { verifyCredentials } from "@/features/auth/service";

const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        return verifyCredentials(parsed.data.email, parsed.data.password);
      },
    }),
  ],
  callbacks: {
    // Stamp the token with its issue time (seconds) for revocation checks.
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.isSuperAdmin = Boolean((user as { isSuperAdmin?: boolean }).isSuperAdmin);
        token.stamp = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.isSuperAdmin = token.isSuperAdmin ?? false;
      session.user.stamp = token.stamp;
      return session;
    },
  },
});
