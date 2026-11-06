"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import {
  DashboardIcon,
  LeafIcon,
  LogoutIcon,
  ReviewIcon,
  SettingsIcon,
  TruckIcon,
  UploadIcon,
} from "@/components/icons";
import { ROLE_LABELS, canOpen, type Role } from "@/lib/permissions";

const NAV = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon },
  { href: "/review", label: "Review", Icon: ReviewIcon },
  { href: "/approved", label: "Approved orders", Icon: TruckIcon },
  { href: "/upload", label: "Upload data", Icon: UploadIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function Sidebar({ pendingCount, user }: { pendingCount: number; user: { username: string; role: Role } }) {
  const pathname = usePathname();
  // The sign-in page gets the whole screen.
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/sku/") : pathname.startsWith(href);

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <LeafIcon size={18} />
        </span>
        <span>
          <span className="brand-name">Freshroots</span>
          <span className="brand-sub">Demand planner</span>
        </span>
      </Link>
      <nav className="side-nav" aria-label="Main">
        {NAV.filter((n) => canOpen(user.role, n.href)).map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={`side-link ${isActive(href) ? "active" : ""}`}>
            <Icon />
            <span>{label}</span>
            {href === "/review" && pendingCount > 0 && <span className="count">{pendingCount}</span>}
          </Link>
        ))}
      </nav>
      <div className="side-foot">
        <Link
          href="/account"
          className={`side-user ${pathname === "/account" ? "active" : ""}`}
          title="Your account and password"
        >
          <span className="avatar" aria-hidden="true">
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <span className="side-user-text">
            <span className="side-user-name">{user.username}</span>
            <span className="side-user-role">{ROLE_LABELS[user.role]}</span>
          </span>
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="side-link signout-btn" aria-label="Sign out">
            <LogoutIcon />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
