"use client";

import { useActionState } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <input
        name="username"
        placeholder="Username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus
        aria-label="Username"
      />
      <PasswordInput
        name="password"
        placeholder="Password"
        autoComplete="current-password"
        hint="Passwords are case-sensitive. Use the eye to check what you typed."
      />
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state.error && (
        <div className="status status-error" role="alert">
          {state.error}
        </div>
      )}
    </form>
  );
}
