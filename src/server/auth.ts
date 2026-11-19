// تسجيل الدخول: تشفير كلمات المرور (scrypt) وجلسات محفوظة في قاعدة البيانات
import type { NextFunction, Request, Response } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { pool } from "./db.ts";

const SESSION_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected);
}

/** عند أول تشغيل: حساب مدير افتراضي (admin / admin123) يُغيَّر من الإعدادات */
export async function ensureDefaultAdmin() {
  const { rowCount } = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (!rowCount)
    await pool.query("INSERT INTO users (username, full_name, password_hash) VALUES ($1,$2,$3)", ["admin", "مدير النظام", hashPassword("admin123")]);
  await pool.query("INSERT INTO settings (key, value) VALUES ('orgName', 'المركز الرياضي'), ('publicBoard', 'off') ON CONFLICT (key) DO NOTHING");
}

export async function login(username: string, password: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (!rows[0] || !verifyPassword(password, rows[0].password_hash)) return null;
  const token = randomBytes(32).toString("hex");
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  await pool.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2, now() + interval '${SESSION_DAYS} days')`, [token, rows[0].id]);
  return token;
}

export const sessionCookie = (token: string, clear = false) =>
  `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;

const tokenFrom = (req: Request) => /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];

export async function logout(req: Request) {
  const token = tokenFrom(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** يحمي كل مسارات /api عدا تسجيل الدخول */
export async function requireUser(req: Request, res: Response, next: NextFunction, expired = "انتهت الجلسة. سجّل الدخول من جديد.") {
  const token = tokenFrom(req);
  const { rows } = token
    ? await pool.query(
        "SELECT u.id, u.username, u.full_name, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
        [token],
      )
    : { rows: [] };
  if (!rows[0]) return res.status(401).json({ error: expired });
  res.locals.user = rows[0];
  next();
}
