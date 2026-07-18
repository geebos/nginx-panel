import { defineConfig } from "drizzle-kit";

// drizzle-kit config — generate-only.
// `drizzle-kit generate` reads the shared schema and writes SQL migrations
// to ./drizzle. Apply them via `wrangler d1 migrations apply` (D1 native,
// tracked in the d1_migrations table), not `drizzle-kit migrate`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/shared/schemas/todo.ts",
  out: "./drizzle",
});
