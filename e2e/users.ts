// Test-only accounts for the end-to-end tests. They exist only in the throwaway ./.pglite-e2e database
// that e2e/seed.ts rebuilds on every run, never on the live site.
export const E2E_USERS = {
  planner: { username: "e2e_planner", password: "e2e-planner-pass-1" },
  procurement: { username: "e2e_procurement", password: "e2e-procurement-pass-1" },
  viewer: { username: "e2e_viewer", password: "e2e-viewer-pass-1" },
} as const;

export type E2eRole = keyof typeof E2E_USERS;
