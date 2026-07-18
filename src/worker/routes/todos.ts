import { Hono } from "hono";
import { asc, sql, eq } from "drizzle-orm";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "@/worker/lib/errors";
import { jsonValidator } from "@/worker/lib/validator";
import { affectedRows } from "@/worker/db/engine";
import {
  todos,
  createTodoSchema,
  updateTodoSchema,
  type Todo,
  type CreateTodoInput,
  type UpdateTodoInput,
} from "@/shared/schemas";

export const todosRoute = new Hono<AppEnv>();

// D1 row (snake_case columns, completed as 0/1) → API Todo (camelCase, completed as boolean).
function toTodo(row: typeof todos.$inferSelect): Todo {
  return {
    id: row.id,
    task: row.task,
    priority: row.priority as Todo["priority"],
    dueDate: row.dueDate,
    completed: row.completed === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/todos — server-side SQL ORDER BY.
// Order: uncompleted first, then high→medium→low, then earlier dueDate, then earlier createdAt.
todosRoute.get("/todos", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(todos)
    .orderBy(
      asc(todos.completed),
      sql`CASE ${todos.priority} WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC`,
      asc(todos.dueDate),
      asc(todos.createdAt),
    );
  return c.json(rows.map(toTodo));
});

// POST /api/todos
todosRoute.post("/todos", jsonValidator(createTodoSchema), async (c) => {
  const input = c.req.valid("json") as CreateTodoInput;
  const now = Date.now();
  const id = crypto.randomUUID();
  const db = c.get("db");
  const row = {
    ...input,
    id,
    completed: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(todos).values(row);
  return c.json(toTodo({ ...row, completed: 0 }), 201);
},
);

// PATCH /api/todos/:id — partial update; updatedAt always refreshed.
todosRoute.patch("/todos/:id", jsonValidator(updateTodoSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json") as UpdateTodoInput;
  const db = c.get("db");

  const patch: Partial<typeof todos.$inferInsert> = { updatedAt: Date.now() };
  if (input.task !== undefined) patch.task = input.task;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.completed !== undefined) patch.completed = input.completed ? 1 : 0;

  const result = await db.update(todos).set(patch).where(eq(todos.id, id));
  // D1 在 result.meta.changes；better-sqlite3 在 result.changes。affectedRows 统一处理。
  const changes = affectedRows(result);
  if (changes === 0) {
    throw new BusinessError("任务不存在", 404);
  }

  const updated = await db.select().from(todos).where(eq(todos.id, id)).get();
  if (!updated) {
    throw new BusinessError("任务不存在", 404);
  }
  return c.json(toTodo(updated));
},
);

// DELETE /api/todos/:id
todosRoute.delete("/todos/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const result = await db.delete(todos).where(eq(todos.id, id));
  const changes = affectedRows(result);
  if (changes === 0) {
    throw new BusinessError("任务不存在", 404);
  }
  return c.body(null, 204);
});
