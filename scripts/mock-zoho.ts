// Runs the fake Zoho Inventory for local development: npm run mock:zoho
// Then in .env.local set ZOHO_API_BASE and ZOHO_ACCOUNTS_BASE to the URL it prints, plus any
// non-empty ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_ORG_ID (the mock ignores
// their values) and ZOHO_ORDERING_ENABLED=1. Never point the live site at it.
import { createMockZoho } from "@/lib/zoho/mock-server";

const port = Number(process.env.MOCK_ZOHO_PORT ?? 4010);
const mock = createMockZoho();
mock.listen(port).then((url) => {
  console.log(`Mock Zoho Inventory running at ${url}`);
  console.log("Vendors: zv-1001..zv-1004 (zv-fail always refuses). Items: zi-001..zi-015 (SKU001..SKU015).");
});
