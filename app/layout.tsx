import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { getDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getPendingCount } from "@/lib/run-engine";
import { currentUser } from "@/lib/session";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Weekly reorder recommendations from sales and stock data.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  // The review count is only shown to roles that can open the Review page.
  const pendingCount =
    user && can(user.role, "viewReview") ? await getPendingCount(await getDb()).catch(() => 0) : 0;

  return (
    <html lang="en-IN" className={inter.variable}>
      <body>
        <div className="app">
          {user && <Sidebar pendingCount={pendingCount} user={{ username: user.username, role: user.role }} />}
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
