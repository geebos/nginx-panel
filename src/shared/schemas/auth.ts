import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "errors:validation.usernameMin")
  .max(64, "errors:validation.usernameMax")
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "errors:validation.usernamePattern");

export const passwordSchema = z
  .string()
  .min(12, "errors:validation.passwordMin")
  .max(128, "errors:validation.passwordMax");

const optionalHostname = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    return value;
  },
  z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/\.$/, ""))
    .pipe(
      z
        .string()
        .max(253)
        .regex(
          /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
          "errors:validation.hostnamePattern",
        ),
    )
    .optional(),
);

export const setupAdminSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  managerPrimaryHostname: optionalHostname,
  managerAliases: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .transform((value) => value.replace(/\.$/, ""))
        .pipe(
          z
            .string()
            .max(253)
            .regex(
              /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
              "errors:validation.hostnamePattern",
            ),
        ),
    )
    .max(100)
    .optional(),
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "errors:validation.passwordRequired").max(128),
  remember: z.boolean().default(false),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "errors:validation.currentPasswordRequired").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().max(128),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "errors:validation.passwordMismatch",
    path: ["confirmPassword"],
  });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const authAttempts = sqliteTable("auth_attempts", {
  usernameIpHash: text("username_ip_hash").primaryKey(),
  failureCount: integer("failure_count").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  blockedUntil: integer("blocked_until").notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SetupAdminInput = z.infer<typeof setupAdminSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
