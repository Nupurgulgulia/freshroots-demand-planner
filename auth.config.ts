// Auth.js settings shared by proxy.ts and auth.ts. No database access here, so the proxy stays light;
// the full check (user still active, current role) happens in lib/session.ts on every page and action.

import type { NextAuthConfig } from "next-auth";
import { isRole } from "@/lib/permissions";

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as { id?: string; name?: string | null; role?: string };
        token.uid = Number(u.id);
        token.username = u.name ?? "";
        token.role = u.role;
      }
      return token;
    },
    session({ session, token }) {
      const role = isRole(token.role) ? token.role : null;
      Object.assign(session.user, { id: String(token.uid ?? ""), name: token.username ?? null, role });
      return session;
    },
  },
} satisfies NextAuthConfig;
