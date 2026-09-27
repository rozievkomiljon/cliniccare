/**
 * Auth.js v5 (next-auth@beta) with the database-session strategy: opaque,
 * revocable session tokens in Postgres behind an httpOnly SameSite=Lax
 * cookie. Credentials sign-in verifies argon2id hashes and audits every
 * attempt. The RBAC layer (src/lib/rbac/guard.ts) builds on `auth()`.
 */
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { verifyCredentials } from "@/features/auth/service";
import { db } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database", maxAge: 7 * 24 * 60 * 60 },
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
  events: {
    // Revocation safety net: sessions older than 48h are pruned on any sign-in.
    signIn: async () => {
      await db.session.deleteMany({
        where: { expires: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
      });
    },
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.isSuperAdmin = user.isSuperAdmin ?? false;
      return session;
    },
  },
});
