import { ChangePasswordForm } from "@/components/forms";
import { ROLE_LABELS } from "@/lib/permissions";
import { requirePage } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requirePage();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your account</h1>
          <p className="muted">Your role decides which pages and buttons you see. An admin changes roles.</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Username</dt>
            <dd>{user.username}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>
              <span className="badge no-dot tone-accent">{ROLE_LABELS[user.role]}</span>
            </dd>
          </dl>
        </div>
        <div className="card">
          <h2>Change password</h2>
          <ChangePasswordForm />
        </div>
      </div>
    </>
  );
}
