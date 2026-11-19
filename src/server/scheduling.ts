// الجسر بين قاعدة البيانات والمحرّك: يقرأ البيانات، يشغّل المحرّك، يحفظ الجدول، ويتحقق من التعديلات اليدوية
import { scheduleFcfs } from "../baseline/fcfs.ts";
import { computeMetrics, countViolations, slotConflict } from "../engine/metrics.ts";
import { generateSlots, solve } from "../engine/scheduler.ts";
import type { Assignment, Problem, SlotValue } from "../engine/types.ts";
import { buildReferenceScenario } from "../scenario/reference.ts";
import { pool } from "./db.ts";
import { InputError } from "./http.ts";

export const DAYS = 7;

/** تسجيل عملية في سجل النشاط: رمز العملية وتفاصيلها (تعرضها الواجهة بلغة المستخدم) */
export async function log(username: string, action: string, params: Record<string, unknown> = {}) {
  await pool.query("INSERT INTO activity (username, action, params) VALUES ($1, $2, $3)", [username, action, params]);
}

export async function loadState() {
  const q = (sql: string) => pool.query(sql).then((r) => r.rows);
  const [facilities, closures, teams, requests, assignments, unscheduled, runs, settings, users, activity] = await Promise.all([
    q("SELECT * FROM facilities ORDER BY id"),
    q("SELECT * FROM closures ORDER BY day, from_hour"),
    q("SELECT * FROM teams ORDER BY id"),
    q("SELECT * FROM requests ORDER BY id"),
    // الحجز «مثبّت» إذا طابق موضعُه الموعدَ المثبّت في طلبه
    q(`SELECT a.*, COALESCE(r.fixed_facility_id = a.facility_id AND r.fixed_day = a.day AND r.fixed_hour = a.hour, FALSE) AS fixed
       FROM assignments a JOIN requests r ON r.id = a.request_id ORDER BY a.day, a.hour`),
    q("SELECT * FROM unscheduled ORDER BY request_id"),
    q("SELECT * FROM runs ORDER BY id DESC LIMIT 12"),
    q("SELECT key, value FROM settings"),
    q("SELECT id, username, full_name, created_at FROM users ORDER BY id"),
    q("SELECT * FROM activity ORDER BY id DESC LIMIT 80"),
  ]);
  return {
    facilities, closures, teams, requests, assignments, unscheduled, runs, users, activity,
    lastRun: runs[0] ?? null,
    settings: { orgName: "", publicBoard: "off", ...Object.fromEntries(settings.map((r) => [r.key, r.value])) },
  };
}
type State = Awaited<ReturnType<typeof loadState>>;

/** تحويل بيانات قاعدة البيانات إلى مسألة المحرّك */
function toProblem(state: State): Problem {
  return {
    days: DAYS,
    // المرفق الخارج عن الخدمة لا يدخل المسألة أصلاً
    facilities: state.facilities
      .filter((f) => f.active)
      .map((f) => ({ id: String(f.id), name: f.name, type: f.type, openHour: f.open_hour, closeHour: f.close_hour })),
    closures: state.closures.map((c) => ({ facilityId: String(c.facility_id), day: c.day, fromHour: c.from_hour, toHour: c.to_hour })),
    teams: state.teams.map((t) => ({ id: String(t.id), name: t.name })),
    requests: state.requests.map((r) => ({
      id: String(r.id),
      teamId: String(r.team_id),
      facilityType: r.facility_type,
      preferred: r.pref_day === null ? undefined : { day: r.pref_day, hour: r.pref_hour },
      fixed: r.fixed_facility_id === null ? undefined : { facilityId: String(r.fixed_facility_id), day: r.fixed_day, hour: r.fixed_hour },
    })),
  };
}

const toAssignments = (state: State): Assignment[] =>
  state.assignments.map((a) => ({
    requestId: String(a.request_id), teamId: String(a.team_id), facilityId: String(a.facility_id),
    day: a.day, hour: a.hour, matchedPreference: a.matched_preference, fixed: a.fixed, reason: a.reason, reasonArgs: a.reason_args ?? undefined,
  }));

/** تشغيل المحرّك على البيانات الحالية. عند وجود جدول سابق تُحفظ المواضع ما أمكن (إعادة جدولة). */
export async function runScheduler(username: string) {
  const state = await loadState();
  const problem = toProblem(state);
  if (problem.requests.length === 0) throw new InputError("no_requests");

  const previous = new Map<string, SlotValue>(toAssignments(state).map((a) => [a.requestId, a]));
  const t0 = performance.now();
  const schedule = solve(problem, { previous });
  const durationMs = performance.now() - t0;

  // لا نحفظ جدولاً فيه أي خرق (صمّام أمان مستقل عن المحرّك)
  if (countViolations(problem, schedule).total > 0) throw new InputError("schedule_rejected");

  const moved = schedule.assignments.filter((a) => {
    const old = previous.get(a.requestId);
    return old && (old.facilityId !== a.facilityId || old.day !== a.day || old.hour !== a.hour);
  }).length;
  const metrics = computeMetrics(problem, schedule);
  const baseline = computeMetrics(problem, scheduleFcfs(problem));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM assignments");
    await client.query("DELETE FROM unscheduled");
    for (const a of schedule.assignments)
      await client.query(
        "INSERT INTO assignments (request_id, team_id, facility_id, day, hour, matched_preference, reason, reason_args) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [a.requestId, a.teamId, a.facilityId, a.day, a.hour, a.matchedPreference, a.reason, a.reasonArgs ?? null],
      );
    for (const u of schedule.unscheduled)
      await client.query("INSERT INTO unscheduled (request_id, reason, reason_args) VALUES ($1,$2,$3)", [u.requestId, u.reason, u.reasonArgs ?? null]);
    await client.query(
      "INSERT INTO runs (username, duration_ms, moved, metrics, baseline, stats) VALUES ($1,$2,$3,$4,$5,$6)",
      [username, durationMs, moved, metrics, baseline, schedule.stats],
    );
    await client.query("INSERT INTO activity (username, action, params) VALUES ($1,$2,$3)", [
      username, "schedule_run", { scheduled: metrics.scheduled, unscheduled: schedule.unscheduled.length, moved },
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** المواضع الصالحة لطلب معيّن (لنقله يدوياً أو وضعه إن كان غير ملبّى)، مرتبة بالقرب من وقته المفضّل */
export async function slotOptions(requestId: number) {
  const state = await loadState();
  const problem = toProblem(state);
  const request = problem.requests.find((r) => r.id === String(requestId));
  if (!request) throw new InputError("request_not_found");
  const others = toAssignments(state);
  const current = others.find((a) => a.requestId === request.id);
  const p = request.preferred;
  return generateSlots(problem.facilities.filter((f) => f.type === request.facilityType), DAYS, problem.closures)
    .filter((s) => slotConflict(problem, others, request, s) === null)
    .filter((s) => !current || current.facilityId !== s.facilityId || current.day !== s.day || current.hour !== s.hour)
    .map((s) => ({ facilityId: Number(s.facilityId), day: s.day, hour: s.hour, preferred: !!p && p.day === s.day && p.hour === s.hour }))
    .sort((a, b) => (p ? Math.abs(a.day - p.day) * 100 + Math.abs(a.hour - p.hour) - (Math.abs(b.day - p.day) * 100 + Math.abs(b.hour - p.hour)) : 0) || a.day - b.day || a.hour - b.hour);
}

/** جدولة يدوية: نقل حجز أو وضع طلب غير ملبّى في موضع يختاره المدير، بعد فحصه بالقيود الصلبة نفسها */
export async function placeManually(requestId: number, slot: SlotValue, username: string) {
  const state = await loadState();
  const problem = toProblem(state);
  const request = problem.requests.find((r) => r.id === String(requestId));
  if (!request) throw new InputError("request_not_found");
  const conflict = slotConflict(problem, toAssignments(state), request, slot);
  if (conflict) throw new InputError("place_conflict", { reason: `conflict.${conflict.code}`, team: conflict.team ?? "" });

  const facility = state.facilities.find((f) => String(f.id) === slot.facilityId)!;
  const team = state.teams.find((t) => String(t.id) === request.teamId)!;
  const matched = !!request.preferred && request.preferred.day === slot.day && request.preferred.hour === slot.hour;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM assignments WHERE request_id = $1", [requestId]);
    await client.query("DELETE FROM unscheduled WHERE request_id = $1", [requestId]);
    await client.query(
      "INSERT INTO assignments (request_id, team_id, facility_id, day, hour, matched_preference, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [requestId, request.teamId, slot.facilityId, slot.day, slot.hour, matched, "manual"],
    );
    // الموضع اليدوي يُثبَّت تلقائياً حتى لا تغيّره الجدولة التالية
    await client.query("UPDATE requests SET fixed_facility_id = $1, fixed_day = $2, fixed_hour = $3 WHERE id = $4", [
      slot.facilityId, slot.day, slot.hour, requestId,
    ]);
    await client.query("INSERT INTO activity (username, action, params) VALUES ($1,$2,$3)", [
      username, "manual_booking", { team: team.name, facility: facility.name, day: slot.day, hour: slot.hour, id: requestId },
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** تثبيت حجز في موضعه الحالي أو إلغاء تثبيته */
export async function setFixed(requestId: number, fixed: boolean, username: string) {
  const { rows } = await pool.query(
    "SELECT a.*, t.name AS team FROM assignments a JOIN teams t ON t.id = a.team_id WHERE a.request_id = $1", [requestId]);
  if (!rows[0]) throw new InputError("no_booking");
  const a = rows[0];
  await pool.query("UPDATE requests SET fixed_facility_id = $1, fixed_day = $2, fixed_hour = $3 WHERE id = $4",
    fixed ? [a.facility_id, a.day, a.hour, requestId] : [null, null, null, requestId]);
  await log(username, fixed ? "fixed_on" : "fixed_off", { team: a.team, day: a.day, hour: a.hour, id: requestId });
}

/** حذف بيانات التشغيل (تبقى الحسابات والإعدادات وسجل النشاط) */
export async function clearData() {
  await pool.query("TRUNCATE facilities, closures, teams, requests, assignments, unscheduled, runs RESTART IDENTITY CASCADE");
}

// بيانات اتصال افتراضية للبيانات التجريبية
const COACHES = [
  "عمر الطيب", "خالد عبد الرحيم", "مصطفى إدريس", "ياسر محجوب", "هشام النور", "طارق بابكر", "معتز الأمين",
  "أيمن صديق", "وليد حسن", "عادل الفاضل", "سامي عثمان", "ماجد يوسف", "أنس الماحي", "حاتم عبد الله",
  "فيصل مكي", "رامي الزين", "نزار علي", "بشير آدم", "صلاح موسى", "منير جعفر",
];
// الأسماء نفسها بالإنجليزية عند تحميل البيانات التجريبية من الواجهة الإنجليزية (بالترتيب نفسه)
const EN_FACILITIES = ["Main Pitch", "Training Pitch", "Basketball Hall", "Volleyball Hall"];
const EN_TEAMS = [
  "Al-Rowad Academy (Juniors)", "Al-Rowad Academy (Youth)", "Al-Mustaqbal Academy (Under-12)",
  "Computer Science – Neelain", "Commerce – Neelain", "Engineering – Khartoum",
  "Al-Fajr Secondary School", "Neighbourhood Youth Centre", "Veterans XI", "Staff Club",
  "Al-Qimma Academy (Juniors)", "Al-Qimma Academy (Youth)", "Law – Neelain", "Medicine – Khartoum", "University of Khartoum Women", "Al-Nahda Secondary School",
  "Economics – Khartoum", "Arts – Neelain", "Al-Hadaf Sports Club", "Al-Fajr School (Girls)",
];
const EN_COACHES = [
  "Omar Al-Tayeb", "Khalid Abdelrahim", "Mustafa Idris", "Yasir Mahjoub", "Hisham Al-Nour", "Tariq Babiker", "Mutaz Al-Amin",
  "Ayman Siddig", "Waleed Hassan", "Adil Al-Fadil", "Sami Osman", "Majid Yousif", "Anas Al-Mahi", "Hatim Abdalla",
  "Faisal Makki", "Rami Al-Zain", "Nizar Ali", "Bashir Adam", "Salah Musa", "Munir Jaafar",
];
const demoPhone = (i: number) => ["091", "092", "099", "090"][i % 4] + String((4_817_263 + i * 1_370_411) % 10_000_000).padStart(7, "0");

/** تحميل البيانات التجريبية (السيناريو المرجعي: 4 مرافق، 20 فريقاً، 121 طلباً) بدل البيانات الحالية */
export async function seedReferenceScenario(lang: "ar" | "en" = "ar") {
  const scenario = buildReferenceScenario();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE facilities, closures, teams, requests, assignments, unscheduled, runs RESTART IDENTITY CASCADE");
    for (const [i, f] of scenario.facilities.entries())
      await client.query("INSERT INTO facilities (name, type, open_hour, close_hour) VALUES ($1,$2,$3,$4)", [
        lang === "en" ? EN_FACILITIES[i] : f.name, f.type, f.openHour, f.closeHour,
      ]);
    const teamId = new Map<string, number>();
    for (const [i, t] of scenario.teams.entries()) {
      const { rows } = await client.query("INSERT INTO teams (name, coach, phone) VALUES ($1,$2,$3) RETURNING id", [
        lang === "en" ? EN_TEAMS[i] : t.name, lang === "en" ? EN_COACHES[i] : COACHES[i], demoPhone(i),
      ]);
      teamId.set(t.id, rows[0].id);
    }
    for (const r of scenario.requests)
      await client.query("INSERT INTO requests (team_id, facility_type, pref_day, pref_hour) VALUES ($1,$2,$3,$4)", [
        teamId.get(r.teamId), r.facilityType, r.preferred?.day ?? null, r.preferred?.hour ?? null,
      ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** بيانات لوحة العرض العامة: أسماء الفرق ومواعيدها فقط، بلا بيانات اتصال */
export async function boardData() {
  const s = await loadState();
  if (s.settings.publicBoard !== "on") return null;
  const team = new Map(s.teams.map((t) => [t.id, t.name]));
  return {
    orgName: s.settings.orgName,
    facilities: s.facilities.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name, type: f.type, open: f.open_hour, close: f.close_hour })),
    sessions: s.assignments.map((a) => ({ facilityId: a.facility_id, day: a.day, hour: a.hour, team: team.get(a.team_id) })),
    closures: s.closures.map((c) => ({ facilityId: c.facility_id, day: c.day, from: c.from_hour, to: c.to_hour, reason: c.reason })),
  };
}
