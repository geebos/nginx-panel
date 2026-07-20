import { createHash, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { setCookie } from "hono/cookie";
import { authAttempts, sessions, type User } from "@/shared/schemas";
import type { AppEnv } from "@/worker/types";
import { BusinessError } from "./errors";
import { getSessionPolicy } from "./session-policy";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const PASSWORD_CHANGE_WINDOW_MS = 30 * 60 * 1000;
const PASSWORD_CHANGE_BLOCK_MS = 30 * 60 * 1000;
const PASSWORD_CHANGE_FAILURE_LIMIT = 3;
const MASTER_KEY_FILE = process.env.NGINX_MANAGER_MASTER_KEY_FILE ?? "/run/secrets/nginx_manager_master_key";

export const SESSION_COOKIE = "nginx_manager_session";
export const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;

let authAttemptKey: Buffer | null = null;

async function getAuthAttemptKey() {
  if (authAttemptKey) return authAttemptKey;

  let master: Buffer;
  try {
    master = await readFile(MASTER_KEY_FILE);
  } catch (error) {
    if (process.env.APP_ENV !== "development") {
      throw new BusinessError(
        "errors:secretMasterKeyUnavailable",
        503,
        "SECRET_MASTER_KEY_UNAVAILABLE",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    master = Buffer.from(
      process.env.NGINX_MANAGER_DEV_MASTER_KEY ?? "nginx-manager-development-key",
    );
  }

  authAttemptKey = Buffer.from(
    hkdfSync("sha256", master, "nginx-domain-manager", "auth-attempts-v1", 32),
  );
  return authAttemptKey;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function derivePassword(password: string, salt: Buffer, length: number, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, { N: n, r, p, maxmem: 32 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, 64, 16_384, 8, 1);
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const derived = await derivePassword(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length,
    Number(n),
    Number(r),
    Number(p),
  );
  return timingSafeEqual(expected, derived);
}

async function authAttemptId(purpose: "login" | "password_change" | "rebuild_active", subject: string, clientIp: string) {
  const key = await getAuthAttemptKey();
  return createHmac("sha256", key)
    .update(`${purpose}\0${subject}\0${clientIp}`)
    .digest("hex");
}

async function assertAttemptAllowed(
  db: AppEnv["Variables"]["db"],
  id: string,
) {
  const attempt = await db.query.authAttempts.findFirst({
    where: eq(authAttempts.usernameIpHash, id),
  });
  const now = Date.now();
  if (attempt && attempt.blockedUntil > now) {
    throw new BusinessError("errors:authRateLimited", 429, "AUTH_RATE_LIMITED", {
      retryAfterSeconds: Math.ceil((attempt.blockedUntil - now) / 1000),
    });
  }
}

export async function assertLoginAllowed(
  db: AppEnv["Variables"]["db"],
  username: string,
  clientIp: string,
) {
  const id = await authAttemptId("login", username, clientIp);
  await assertAttemptAllowed(db, id);
  return id;
}

export async function recordLoginFailure(
  db: AppEnv["Variables"]["db"],
  id: string,
) {
  await recordAttemptFailure(db, id, LOGIN_WINDOW_MS, LOGIN_FAILURE_LIMIT, LOGIN_BLOCK_MS);
}

async function recordAttemptFailure(
  db: AppEnv["Variables"]["db"],
  id: string,
  windowMs: number,
  failureLimit: number,
  blockMs: number,
) {
  const now = Date.now();
  db.transaction((tx) => {
    const current = tx
      .select()
      .from(authAttempts)
      .where(eq(authAttempts.usernameIpHash, id))
      .get();
    const expired = !current || now - current.windowStartedAt >= windowMs;
    const failureCount = expired ? 1 : current.failureCount + 1;
    const blockedUntil = failureCount >= failureLimit ? now + blockMs : 0;

    tx.insert(authAttempts)
      .values({
        usernameIpHash: id,
        failureCount,
        windowStartedAt: expired ? now : current.windowStartedAt,
        blockedUntil,
      })
      .onConflictDoUpdate({
        target: authAttempts.usernameIpHash,
        set: {
          failureCount,
          windowStartedAt: expired ? now : current.windowStartedAt,
          blockedUntil,
        },
      })
      .run();
  });
}

export async function clearLoginFailures(db: AppEnv["Variables"]["db"], id: string) {
  await db.delete(authAttempts).where(eq(authAttempts.usernameIpHash, id));
}

export async function assertRebuildAllowed(
  db: AppEnv["Variables"]["db"],
  userId: string,
  clientIp: string,
) {
  const id = await authAttemptId("rebuild_active", userId, clientIp);
  await assertAttemptAllowed(db, id);
  return id;
}

export const recordRebuildFailure = recordLoginFailure;
export const clearRebuildFailures = clearLoginFailures;

export async function assertPasswordChangeAllowed(
  db: AppEnv["Variables"]["db"],
  userId: string,
  clientIp: string,
) {
  const id = await authAttemptId("password_change", userId, clientIp);
  await assertAttemptAllowed(db, id);
  return id;
}

export async function recordPasswordChangeFailure(
  db: AppEnv["Variables"]["db"],
  id: string,
) {
  await recordAttemptFailure(
    db,
    id,
    PASSWORD_CHANGE_WINDOW_MS,
    PASSWORD_CHANGE_FAILURE_LIMIT,
    PASSWORD_CHANGE_BLOCK_MS,
  );
}

export const clearPasswordChangeFailures = clearLoginFailures;

export function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
  expiresAt: number,
) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.APP_ENV !== "development",
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function createSession(
  db: AppEnv["Variables"]["db"],
  user: Pick<User, "id">,
  remember: boolean,
) {
  const token = createSessionToken();
  const now = Date.now();
  const policy = await getSessionPolicy(db);
  const expiresAt = now + (remember ? policy.rememberDays : policy.standardDays) * 24 * 60 * 60 * 1000;
  await db.insert(sessions).values({
    idHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
  });
  return { token, expiresAt };
}
