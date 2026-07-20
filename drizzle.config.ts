import { defineConfig } from "drizzle-kit";

// drizzle-kit config — generate-only.
// `drizzle-kit generate` reads the shared schema and writes SQL migrations
// to ./drizzle. The Node server applies them automatically on startup via
// drizzle-orm's better-sqlite3 migrator (see src/worker/lib/db/engine.ts).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/shared/schemas/index.ts",
  out: "./drizzle",
});
