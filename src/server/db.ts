// الاتصال بقاعدة البيانات PostgreSQL وتهيئة الجداول
import { readFileSync } from "node:fs";
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sports_scheduler",
});

export async function initSchema() {
  await pool.query(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
}
