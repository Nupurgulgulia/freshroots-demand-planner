import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Weekly reorder recommendations from sales and stock data.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/review", label: "Review" },
  { href: "/approved", label: "Approved orders" },
  { href: "/upload", label: "Upload data" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Freshroots Demand Planner
          </Link>
          <nav>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
