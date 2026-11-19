// الاتصال بقاعدة البيانات PostgreSQL وتهيئة الجداول
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sports_scheduler";

export const pool = new pg.Pool({
  connectionString: url,
  // خدمات الاستضافة السحابية (Render وغيرها) تتطلب اتصالاً مشفّراً؛ محلياً لا يلزم
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
}
