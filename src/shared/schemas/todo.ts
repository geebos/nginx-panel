import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";

// UTC-midnight-today as a ms timestamp. dueDate values submitted by the form
// are UTC-midnight of the picked calendar date, so create-time validation
// compares apples to apples regardless of the worker's local timezone.
export function utcStartOfTodayMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const priorityEnum = z.enum(["low", "medium", "high"]);

export const createTodoSchema = z.object({
  task: z.string().trim().min(1, "任务不能为空").max(200, "任务最多 200 字符"),
  priority: priorityEnum,
  dueDate: z
    .number()
    .int()
    .refine((n) => n >= utcStartOfTodayMs(), "不能选过去日期"),
});

export const updateTodoSchema = z.object({
  task: z.string().trim().min(1, "任务不能为空").max(200, "任务最多 200 字符").optional(),
  priority: priorityEnum.optional(),
  // edit allows keeping an existing past due date (no past-date check here)
  dueDate: z.number().int().optional(),
  completed: z.boolean().optional(),
});

export const todoSchema = z.object({
  id: z.string(),
  task: z.string(),
  priority: priorityEnum,
  dueDate: z.number().int(),
  completed: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  task: text("task").notNull(),
  priority: text("priority").notNull().default("medium"),
  dueDate: integer("due_date").notNull(),
  completed: integer("completed").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Priority = z.infer<typeof priorityEnum>;
export type Todo = z.infer<typeof todoSchema>;
export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
