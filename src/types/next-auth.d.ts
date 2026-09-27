import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isSuperAdmin: boolean;
      /** Issue watermark (unix seconds) used for DB-backed revocation. */
      stamp?: number;
    } & DefaultSession["user"];
  }

  interface User {
    isSuperAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isSuperAdmin?: boolean;
    /** Issue watermark (unix seconds) used for DB-backed revocation. */
    stamp?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    isSuperAdmin?: boolean;
    /** Issue watermark (unix seconds) used for DB-backed revocation. */
    stamp?: number;
  }
}
