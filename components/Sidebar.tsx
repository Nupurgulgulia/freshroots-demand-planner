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

const NAV = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon },
  { href: "/review", label: "Review", Icon: ReviewIcon },
  { href: "/approved", label: "Approved orders", Icon: TruckIcon },
  { href: "/upload", label: "Upload data", Icon: UploadIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function Sidebar({ pendingCount, showSignOut }: { pendingCount: number; showSignOut: boolean }) {
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
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={`side-link ${isActive(href) ? "active" : ""}`}>
            <Icon />
            <span>{label}</span>
            {href === "/review" && pendingCount > 0 && <span className="count">{pendingCount}</span>}
          </Link>
        ))}
      </nav>
      {showSignOut && (
        <form action={logoutAction} className="side-foot">
          <button type="submit" className="side-link signout-btn">
            <LogoutIcon />
            <span>Sign out</span>
          </button>
        </form>
      )}
    </aside>
  );
}
