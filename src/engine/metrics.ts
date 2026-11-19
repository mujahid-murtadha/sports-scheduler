// التحقق المستقل من صحة الجدول + حساب مؤشرات الأداء
import { generateSlots, isClosed } from "./scheduler.ts";
import type { Assignment, Problem, Request, Schedule, SlotValue } from "./types.ts";

/** مدقّق مستقل عن المحرّك: يعدّ خروقات القيود الصلبة في أي جدول */
export function countViolations(problem: Problem, schedule: Schedule) {
  const facility = new Map(problem.facilities.map((f) => [f.id, f]));
  const request = new Map(problem.requests.map((r) => [r.id, r]));
  const facilitySlot = new Map<string, number>();
  const teamSlot = new Map<string, number>();
  let typeMismatch = 0;
  let outsideHours = 0;
  let closed = 0;

  for (const a of schedule.assignments) {
    const f = facility.get(a.facilityId)!;
    const r = request.get(a.requestId)!;
    if (f.type !== r.facilityType) typeMismatch++;
    if (a.hour < f.openHour || a.hour >= f.closeHour || a.day < 0 || a.day >= problem.days) outsideHours++;
    if (isClosed(problem.closures, a)) closed++;
    const fk = `${a.facilityId}|${a.day}|${a.hour}`;
    const tk = `${a.teamId}|${a.day}|${a.hour}`;
    facilitySlot.set(fk, (facilitySlot.get(fk) ?? 0) + 1);
    teamSlot.set(tk, (teamSlot.get(tk) ?? 0) + 1);
  }
  const extra = (m: Map<string, number>) => [...m.values()].reduce((sum, n) => sum + (n - 1), 0);
  const facilityConflicts = extra(facilitySlot);
  const teamConflicts = extra(teamSlot);
  return {
    facilityConflicts,
    teamConflicts,
    typeMismatch,
    outsideHours,
    closed,
    total: facilityConflicts + teamConflicts + typeMismatch + outsideHours + closed,
  };
}

/**
 * فحص موضع واحد قبل الجدولة اليدوية (نقل حجز أو وضع طلب غير ملبّى):
 * يعيد رمز سبب الرفض، أو null إن كان الموضع يحقق كل القيود الصلبة.
 */
export function slotConflict(problem: Problem, others: Assignment[], request: Request, slot: SlotValue): { code: string; team?: string } | null {
  const f = problem.facilities.find((x) => x.id === slot.facilityId);
  if (!f) return { code: "no_facility" }; // المرفق غير موجود أو خارج الخدمة
  if (f.type !== request.facilityType) return { code: "type_mismatch" };
  if (slot.hour < f.openHour || slot.hour >= f.closeHour || slot.day < 0 || slot.day >= problem.days) return { code: "outside_hours" };
  if (isClosed(problem.closures, slot)) return { code: "closed" };
  const team = new Map(problem.teams.map((t) => [t.id, t.name]));
  for (const a of others) {
    if (a.requestId === request.id || a.day !== slot.day || a.hour !== slot.hour) continue;
    if (a.facilityId === slot.facilityId) return { code: "slot_taken", team: team.get(a.teamId) ?? "" };
    if (a.teamId === request.teamId) return { code: "team_busy_slot" };
  }
  return null;
}

export function computeMetrics(problem: Problem, schedule: Schedule) {
  const totalSlots = generateSlots(problem.facilities, problem.days, problem.closures).length;
  const assigned = schedule.assignments.length;
  const withPref = problem.requests.filter((r) => r.preferred).length;

  // مؤشر العدالة (Jain): على نسبة تلبية كل فريق = جلساته المجدولة ÷ جلساته المطلوبة
  const requested = new Map<string, number>();
  const granted = new Map<string, number>();
  for (const r of problem.requests) requested.set(r.teamId, (requested.get(r.teamId) ?? 0) + 1);
  for (const a of schedule.assignments) granted.set(a.teamId, (granted.get(a.teamId) ?? 0) + 1);
  const ratios = [...requested.entries()].map(([team, n]) => (granted.get(team) ?? 0) / n);
  const sum = ratios.reduce((s, x) => s + x, 0);
  const sumSq = ratios.reduce((s, x) => s + x * x, 0);

  return {
    conflicts: countViolations(problem, schedule).total,
    totalRequests: problem.requests.length,
    scheduled: assigned,
    fulfilmentRate: assigned / problem.requests.length,
    utilization: assigned / totalSlots,
    fairnessIndex: sumSq === 0 ? 0 : (sum * sum) / (ratios.length * sumSq),
    minTeamRatio: Math.min(...ratios),
    preferenceRate: withPref === 0 ? 0 : schedule.assignments.filter((a) => a.matchedPreference).length / withPref,
  };
}
