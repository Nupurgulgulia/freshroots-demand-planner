// Who can do what. Pure, so it is unit-tested and shared by proxy.ts, pages and server actions.

export const ROLES = ["planner", "procurement", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  planner: "Planner",
  procurement: "Procurement",
  viewer: "Viewer",
};

export const isRole = (x: unknown): x is Role => typeof x === "string" && (ROLES as readonly string[]).includes(x);

export type Permission =
  | "viewDashboard"
  | "viewPerformance"
  | "viewSku"
  | "viewReview"
  | "review" // approve / edit / reject
  | "upload"
  | "recalculate"
  | "generateAi"
  | "viewSettings"
  | "editSettings"
  | "viewApproved"
  | "exportOrders"
  | "confirmLargeQty" // Phase 2
  | "sendToZoho"; // Phase 4

const MATRIX: Record<Role, Permission[]> = {
  planner: [
    "viewDashboard",
    "viewPerformance",
    "viewSku",
    "viewReview",
    "review",
    "upload",
    "recalculate",
    "generateAi",
    "viewSettings",
    "editSettings",
    "viewApproved",
    "exportOrders",
  ],
  procurement: [
    "viewDashboard",
    "viewPerformance",
    "viewSku",
    "viewReview",
    "viewApproved",
    "exportOrders",
    "confirmLargeQty",
    "sendToZoho",
  ],
  viewer: ["viewDashboard", "viewPerformance"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role != null && MATRIX[role].includes(permission);
}

/** The permission needed to open a page, by path prefix (most specific first). */
const PAGE_RULES: [prefix: string, permission: Permission][] = [
  ["/approved/export", "exportOrders"],
  ["/approved", "viewApproved"],
  ["/review", "viewReview"],
  ["/sku/", "viewSku"],
  ["/upload", "upload"],
  ["/settings", "viewSettings"],
  ["/performance", "viewPerformance"],
];

/** null = any signed-in user (dashboard, account page). */
export function permissionForPath(pathname: string): Permission | null {
  for (const [prefix, permission] of PAGE_RULES) {
    if (pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) return permission;
  }
  return null;
}

export function canOpen(role: Role | null | undefined, pathname: string): boolean {
  const needed = permissionForPath(pathname);
  return role != null && (needed == null || can(role, needed));
}
