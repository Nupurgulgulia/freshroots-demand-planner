import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="card login-card">
      <h1>Sign in</h1>
      <p className="muted">Enter the team password to use the demand planner.</p>
      <LoginForm next={next ?? "/"} />
    </div>
  );
}
