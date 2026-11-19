// خادم الويب (Express): واجهة برمجية REST + تقديم ملفات الواجهة
import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { ensureDefaultAdmin, hashPassword, login, logout, requireUser, sessionCookie, verifyPassword } from "./auth.ts";
import { initSchema, pool } from "./db.ts";
import { id, InputError, int, optional, text } from "./http.ts";
import { type Lang, message } from "./messages.ts";
import {
  boardData, clearData, loadState, log, placeManually, runScheduler, seedReferenceScenario, setFixed, slotOptions,
} from "./scheduling.ts";

const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL("../../public", import.meta.url))));

const TYPES = ["football", "basketball", "volleyball", "tennis", "handball"];
const facilityType = (v: unknown) => {
  const t = text(v, "facility_type");
  if (!TYPES.includes(t)) throw new InputError("unknown_type");
  return t;
};

/** لغة الواجهة التي أرسلت الطلب (لاختيار لغة رسائل الخطأ) */
const langOf = (req: Request): Lang => (req.headers["x-lang"] === "en" ? "en" : "ar");

/** المستخدم الحالي (اسم الدخول) لتسجيله في سجل النشاط */
const who = (res: Response): string => res.locals.user.username;

/** الحالة الكاملة التي تعرضها الواجهة + المستخدم الحالي */
const sendState = async (res: Response) =>
  res.json({ ...(await loadState()), user: { id: res.locals.user.id, username: who(res), fullName: res.locals.user.full_name } });

const nameOf = async (table: "facilities" | "teams", rowId: unknown) =>
  (await pool.query(`SELECT name FROM ${table} WHERE id = $1`, [rowId])).rows[0]?.name ?? "";

// ---------- الدخول والخروج ----------
app.post("/api/login", async (req, res) => {
  const token = await login(text(req.body.username, "username"), text(req.body.password, "password"));
  if (!token) throw new InputError("bad_login");
  res.setHeader("Set-Cookie", sessionCookie(token)).json({ ok: true });
});

app.post("/api/logout", async (req, res) => {
  await logout(req);
  res.setHeader("Set-Cookie", sessionCookie("", true)).json({ ok: true });
});

// اسم المؤسسة لصفحة الدخول، وهل لوحة العرض العامة مفعّلة
app.get("/api/public/info", async (_req, res) => {
  const { rows } = await pool.query("SELECT key, value FROM settings WHERE key IN ('orgName', 'publicBoard')");
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ orgName: s.orgName ?? "", publicBoard: s.publicBoard === "on" });
});

// لوحة العرض العامة (شاشة المدخل): لا تتطلب دخولاً، وتعمل فقط إذا فعّلتها الإدارة
app.get("/api/public/board", async (req, res) => {
  const data = await boardData();
  if (!data) return res.status(404).json({ error: message(langOf(req), "board_disabled") });
  res.json(data);
});

// كل ما بعد هذا السطر يتطلب تسجيل الدخول
app.use("/api", (req, res, next) => requireUser(req, res, next, message(langOf(req), "session_expired")));

app.get("/api/state", async (_req, res) => sendState(res));

// ---------- المرافق ----------
const facilityInput = (body: Request["body"]) => {
  const open = int(body.openHour, "open_hour", 0, 23);
  const close = int(body.closeHour, "close_hour", 1, 24);
  if (open >= close) throw new InputError("close_after_open");
  return [text(body.name, "facility_name"), facilityType(body.type), open, close] as const;
};

app.post("/api/facilities", async (req, res) => {
  const values = facilityInput(req.body);
  await pool.query("INSERT INTO facilities (name, type, open_hour, close_hour) VALUES ($1,$2,$3,$4)", [...values]);
  await log(who(res), "facility_added", { name: values[0] });
  await sendState(res);
});

app.put("/api/facilities/:id", async (req, res) => {
  const values = facilityInput(req.body);
  await pool.query("UPDATE facilities SET name = $1, type = $2, open_hour = $3, close_hour = $4 WHERE id = $5", [...values, id(req.params.id)]);
  await log(who(res), "facility_edited", { name: values[0] });
  await sendState(res);
});

// إخراج مرفق من الخدمة أو إعادته
app.patch("/api/facilities/:id", async (req, res) => {
  const active = req.body.active === true;
  await pool.query("UPDATE facilities SET active = $1 WHERE id = $2", [active, id(req.params.id)]);
  await log(who(res), active ? "facility_activated" : "facility_deactivated", { name: await nameOf("facilities", req.params.id) });
  await sendState(res);
});

app.delete("/api/facilities/:id", async (req, res) => {
  const name = await nameOf("facilities", req.params.id);
  await pool.query("DELETE FROM facilities WHERE id = $1", [id(req.params.id)]);
  await log(who(res), "facility_deleted", { name });
  await sendState(res);
});

// ---------- فترات الإغلاق ----------
app.post("/api/closures", async (req, res) => {
  const facilityId = id(req.body.facilityId);
  const day = int(req.body.day, "day", 0, 6);
  const from = int(req.body.fromHour, "from_hour", 0, 23);
  const to = int(req.body.toHour, "to_hour", 1, 24);
  if (from >= to) throw new InputError("closure_end_after_start");
  const reason = text(req.body.reason, "closure_reason");
  const name = await nameOf("facilities", facilityId);
  if (!name) throw new InputError("facility_not_found");
  await pool.query("INSERT INTO closures (facility_id, day, from_hour, to_hour, reason) VALUES ($1,$2,$3,$4,$5)", [facilityId, day, from, to, reason]);
  await log(who(res), "closure_added", { facility: name, day, from, to, reason });
  await sendState(res);
});

app.delete("/api/closures/:id", async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM closures c USING facilities f WHERE c.id = $1 AND f.id = c.facility_id RETURNING c.*, f.name", [id(req.params.id)]);
  if (rows[0]) await log(who(res), "closure_removed", { facility: rows[0].name, day: rows[0].day, from: rows[0].from_hour, to: rows[0].to_hour });
  await sendState(res);
});

// ---------- الفرق ----------
const teamInput = async (body: Request["body"], exceptId = 0) => {
  const name = text(body.name, "team_name");
  const exists = await pool.query("SELECT 1 FROM teams WHERE name = $1 AND id <> $2", [name, exceptId]);
  if (exists.rowCount) throw new InputError("team_exists");
  return [name, optional(body.coach), optional(body.phone)] as const;
};

app.post("/api/teams", async (req, res) => {
  const values = await teamInput(req.body);
  await pool.query("INSERT INTO teams (name, coach, phone) VALUES ($1,$2,$3)", [...values]);
  await log(who(res), "team_added", { name: values[0] });
  await sendState(res);
});

app.put("/api/teams/:id", async (req, res) => {
  const teamId = id(req.params.id);
  const values = await teamInput(req.body, teamId);
  await pool.query("UPDATE teams SET name = $1, coach = $2, phone = $3 WHERE id = $4", [...values, teamId]);
  await log(who(res), "team_edited", { name: values[0] });
  await sendState(res);
});

app.delete("/api/teams/:id", async (req, res) => {
  const name = await nameOf("teams", req.params.id);
  await pool.query("DELETE FROM teams WHERE id = $1", [id(req.params.id)]);
  await log(who(res), "team_deleted", { name });
  await sendState(res);
});

// ---------- طلبات الحجز ----------
app.post("/api/requests", async (req, res) => {
  const teamId = id(req.body.teamId);
  const type = facilityType(req.body.facilityType);
  const hasPref = req.body.prefDay !== null && req.body.prefDay !== undefined && req.body.prefDay !== "";
  const day = hasPref ? int(req.body.prefDay, "pref_day", 0, 6) : null;
  const hour = hasPref ? int(req.body.prefHour, "pref_hour", 0, 23) : null;
  const count = req.body.count === undefined ? 1 : int(req.body.count, "count", 1, 14);
  for (let i = 0; i < count; i++)
    await pool.query("INSERT INTO requests (team_id, facility_type, pref_day, pref_hour) VALUES ($1,$2,$3,$4)", [teamId, type, day, hour]);
  await log(who(res), "requests_added", { count, team: await nameOf("teams", teamId), type, day, hour });
  await sendState(res);
});

// إلغاء طلب (يُحذف معه حجزه)
app.delete("/api/requests/:id", async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM requests r USING teams t WHERE r.id = $1 AND t.id = r.team_id RETURNING r.id, t.name", [id(req.params.id)]);
  if (rows[0]) await log(who(res), "request_cancelled", { id: rows[0].id, team: rows[0].name });
  await sendState(res);
});

// المواضع الصالحة للجدولة اليدوية
app.get("/api/requests/:id/options", async (req, res) => res.json(await slotOptions(id(req.params.id))));

// جدولة يدوية (نقل حجز أو وضع طلب غير ملبّى)
app.post("/api/requests/:id/place", async (req, res) => {
  const slot = { facilityId: String(id(req.body.facilityId)), day: int(req.body.day, "day", 0, 6), hour: int(req.body.hour, "hour", 0, 23) };
  await placeManually(id(req.params.id), slot, who(res));
  await sendState(res);
});

app.put("/api/requests/:id/fixed", async (req, res) => {
  await setFixed(id(req.params.id), req.body.fixed === true, who(res));
  await sendState(res);
});

// ---------- الجدولة ----------
app.post("/api/schedule/run", async (_req, res) => {
  await runScheduler(who(res));
  await sendState(res);
});

// ---------- الإعدادات ----------
app.put("/api/settings", async (req, res) => {
  const values: [string, string][] = [
    ["orgName", text(req.body.orgName, "org_name")],
    ["publicBoard", req.body.publicBoard === true ? "on" : "off"],
  ];
  for (const [key, value] of values)
    await pool.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, value]);
  await log(who(res), "settings_updated", { board: values[1][1] === "on" });
  await sendState(res);
});

app.put("/api/password", async (req, res) => {
  const next = text(req.body.next, "new_password");
  if (!verifyPassword(text(req.body.current, "current_password"), res.locals.user.password_hash)) throw new InputError("wrong_password");
  if (next.length < 8) throw new InputError("password_short");
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(next), res.locals.user.id]);
  await log(who(res), "password_changed");
  await sendState(res);
});

// ---------- المستخدمون ----------
app.post("/api/users", async (req, res) => {
  const username = text(req.body.username, "username");
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) throw new InputError("username_format");
  const password = text(req.body.password, "password");
  if (password.length < 8) throw new InputError("password_short");
  const exists = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
  if (exists.rowCount) throw new InputError("username_taken");
  const fullName = text(req.body.fullName, "full_name");
  await pool.query("INSERT INTO users (username, full_name, password_hash) VALUES ($1,$2,$3)", [username, fullName, hashPassword(password)]);
  await log(who(res), "user_added", { name: fullName, username });
  await sendState(res);
});

app.delete("/api/users/:id", async (req, res) => {
  const userId = id(req.params.id);
  if (userId === res.locals.user.id) throw new InputError("cannot_delete_self");
  const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING username, full_name", [userId]);
  if (rows[0]) await log(who(res), "user_deleted", { name: rows[0].full_name, username: rows[0].username });
  await sendState(res);
});

// ---------- البيانات ----------
app.post("/api/data/demo", async (req, res) => {
  await seedReferenceScenario(langOf(req));
  await log(who(res), "demo_loaded");
  await sendState(res);
});

app.post("/api/data/clear", async (_req, res) => {
  await clearData();
  await log(who(res), "data_cleared");
  await sendState(res);
});

// معالجة الأخطاء: رسالة مفهومة بلغة المستخدم
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const lang = langOf(req);
  if (err instanceof InputError) return res.status(400).json({ error: message(lang, err.key, err.params) });
  console.error(err);
  res.status(500).json({ error: message(lang, "server_error") });
});

const port = Number(process.env.PORT ?? 3000);
await initSchema();
await ensureDefaultAdmin();
app.listen(port, () => console.log(`الخادم يعمل: http://localhost:${port}`));
