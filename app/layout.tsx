import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/Sidebar";
import { SESSION_COOKIE, appPassword, isValidSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPendingCount } from "@/lib/run-engine";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Weekly reorder recommendations from sales and stock data.",
};

async function signedIn(password: string | null) {
  if (!password) return true;
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value, password);
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const password = appPassword();
  // Only query (and render) the review count for signed-in visitors.
  const pendingCount = (await signedIn(password)) ? await getPendingCount(await getDb()).catch(() => 0) : 0;

  return (
    <html lang="en-IN" className={inter.variable}>
      <body>
        <div className="app">
          <Sidebar pendingCount={pendingCount} showSignOut={Boolean(password)} />
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
