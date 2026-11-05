"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        placeholder="Password"
        autoComplete="current-password"
        required
        autoFocus
        aria-label="Password"
      />
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state.error && <div className="status status-error">{state.error}</div>}
    </form>
  );
}
