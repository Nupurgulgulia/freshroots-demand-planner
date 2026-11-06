// Auth.js: username + password sign-in against the users table.

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { getDb } from "@/lib/db";
import { attemptLogin } from "@/lib/users";

class LockedSignin extends CredentialsSignin {
  code = "locked";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: { label: "Username" }, password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        const username = String(credentials?.username ?? "");
        const password = String(credentials?.password ?? "");
        if (!username || !password) return null;
        const result = await attemptLogin(await getDb(), username, password);
        if (!result.ok) {
          if (result.reason === "locked") throw new LockedSignin();
          return null;
        }
        const { id, username: name, email, role } = result.user;
        return { id: String(id), name, email, role };
      },
    }),
  ],
});
