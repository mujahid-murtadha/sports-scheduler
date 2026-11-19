// خط الأساس: محاكاة الجدولة اليدوية بمبدأ "الأسبقية في الطلب" (First-Come-First-Served)
// الموظف يعالج الطلبات بترتيب وصولها: الوقت المفضّل، ثم الساعة المجاورة في اليوم نفسه، وإلا يُرفض الطلب.
import { isClosed } from "../engine/scheduler.ts";
import type { Assignment, Problem, Schedule, Unscheduled } from "../engine/types.ts";

export function scheduleFcfs(problem: Problem): Schedule {
  const facilityBusy = new Set<string>();
  const teamBusy = new Set<string>();
  const assignments: Assignment[] = [];
  const unscheduled: Unscheduled[] = [];

  for (const r of problem.requests) {
    const candidates = problem.facilities.filter((f) => f.type === r.facilityType);
    const times = r.preferred
      ? [0, -1, 1].map((d) => ({ day: r.preferred!.day, hour: r.preferred!.hour + d }))
      : Array.from({ length: problem.days * 24 }, (_, i) => ({ day: Math.floor(i / 24), hour: i % 24 }));

    let done = false;
    for (const t of times) {
      if (teamBusy.has(`${r.teamId}|${t.day}|${t.hour}`)) continue;
      const f = candidates.find(
        (c) =>
          t.hour >= c.openHour && t.hour < c.closeHour &&
          !isClosed(problem.closures, { facilityId: c.id, ...t }) &&
          !facilityBusy.has(`${c.id}|${t.day}|${t.hour}`),
      );
      if (!f) continue;
      facilityBusy.add(`${f.id}|${t.day}|${t.hour}`);
      teamBusy.add(`${r.teamId}|${t.day}|${t.hour}`);
      const matched = !!r.preferred && t.hour === r.preferred.hour;
      assignments.push({
        requestId: r.id, teamId: r.teamId, facilityId: f.id, day: t.day, hour: t.hour,
        matchedPreference: matched, fixed: false, reason: matched ? "matched" : "shifted", // الوقت المطلوب أو الساعة المجاورة
      });
      done = true;
      break;
    }
    if (!done) unscheduled.push({ requestId: r.id, teamId: r.teamId, reason: "rejected" }); // الوقت المطلوب وما يجاوره محجوز
  }
  return { assignments, unscheduled, stats: { searchSteps: 0, backtracks: 0, relaxations: 0 } };
}
