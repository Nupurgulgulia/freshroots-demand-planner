import { LeafIcon } from "@/components/icons";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Optional text shown above the form, e.g. demo accounts for reviewers. It lives in the LOGIN_HINT
  // environment variable (set in Vercel), never in the code, and disappears when the variable is removed.
  const loginHint = process.env.LOGIN_HINT?.trim();
  return (
    <div className="login-shell">
      <div className="card login-card">
        <span className="brand-mark">
          <LeafIcon size={22} />
        </span>
        <h1>Welcome back</h1>
        <p className="muted" style={{ margin: "0 0 22px" }}>
          Sign in to the Freshroots demand planner with your own username and password.
        </p>
        {loginHint && (
          <div className="login-hint" role="note">
            <strong>Demo access</strong>
            <span>{loginHint}</span>
          </div>
        )}
        <LoginForm next={next ?? "/"} />
        <div className="login-foot">
          Forgot your password, or locked out? Ask your admin to reset it. After 5 wrong tries the account locks for
          15 minutes.
        </div>
      </div>
    </div>
  );
}
