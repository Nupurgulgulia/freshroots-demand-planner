import { LeafIcon } from "@/components/icons";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="login-shell">
      <div className="card login-card">
        <span className="brand-mark">
          <LeafIcon size={22} />
        </span>
        <h1>Welcome back</h1>
        <p className="muted" style={{ margin: "0 0 22px" }}>
          Sign in to the Freshroots demand planner with your team password.
        </p>
        <LoginForm next={next ?? "/"} />
        <div className="login-foot">Freshroots · Demand planning</div>
      </div>
    </div>
  );
}
