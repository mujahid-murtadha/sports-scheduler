// اختبارات آلية على حالات مرجعية صغيرة معلومة النتيجة
import assert from "node:assert/strict";
import { test } from "node:test";
import { countViolations, slotConflict } from "../src/engine/metrics.ts";
import { solve } from "../src/engine/scheduler.ts";
import type { Facility, Problem, Request } from "../src/engine/types.ts";
import { buildReferenceScenario } from "../src/scenario/reference.ts";
import { buildStressScenario } from "../src/scenario/stress.ts";

const pitch = (id: string, open: number, close: number, type = "football"): Facility => ({ id, name: id, type, openHour: open, closeHour: close });
const teams = ["A", "B", "C"].map((id) => ({ id, name: id }));
const req = (id: string, teamId: string, facilityType = "football", day?: number, hour?: number): Request => ({
  id, teamId, facilityType, preferred: day === undefined ? undefined : { day, hour: hour! },
});
const problem = (facilities: Facility[], requests: Request[], days = 1): Problem => ({ facilities, teams, requests, days });

test("طلبان على فترة واحدة: يُجدوَل واحد ويُرفض الآخر بسبب", () => {
  const s = solve(problem([pitch("F", 18, 19)], [req("r1", "A"), req("r2", "B")]));
  assert.equal(s.assignments.length, 1);
  assert.equal(s.assignments[0].requestId, "r1");
  assert.equal(s.unscheduled.length, 1);
  assert.equal(s.unscheduled[0].reason, "over_capacity");
});

test("نوع المرفق قيد صلب: لا يُستبدل السلة بالقدم", () => {
  const s = solve(problem([pitch("F", 16, 22)], [req("r1", "A", "basketball")]));
  assert.equal(s.assignments.length, 0);
  assert.equal(s.unscheduled[0].reason, "no_type");
});

test("الوقت المفضّل يُلبّى إن كان متاحاً، وإلا فأقرب فترة", () => {
  const s = solve(problem([pitch("F", 16, 22)], [req("r1", "A", "football", 0, 19), req("r2", "B", "football", 0, 19)]));
  const hours = s.assignments.map((a) => a.hour).sort();
  assert.equal(s.assignments.filter((a) => a.matchedPreference).length, 1);
  assert.ok(hours.includes(19) && (hours.includes(18) || hours.includes(20)));
});

test("الفريق لا يكون في مرفقين في الوقت نفسه", () => {
  const s = solve(problem([pitch("F1", 18, 19), pitch("F2", 18, 19)], [req("r1", "A"), req("r2", "A")]));
  assert.equal(s.assignments.length, 1);
  assert.equal(s.unscheduled.length, 1);
  assert.equal(s.stats.relaxations, 1);
});

test("العدالة: عند الندرة تُوزَّع الفترات بالتساوي ولا يحتكرها أول الواصلين", () => {
  const requests = [req("a1", "A"), req("a2", "A"), req("a3", "A"), req("b1", "B"), req("c1", "C")];
  const s = solve(problem([pitch("F", 16, 19)], requests));
  const byTeam = (t: string) => s.assignments.filter((a) => a.teamId === t).length;
  assert.deepEqual([byTeam("A"), byTeam("B"), byTeam("C")], [1, 1, 1]);
});

test("المرفق الفارغ يُمنح ولو زادت جلسات الفريق (لا سقف أعمى)", () => {
  const s = solve(problem([pitch("F", 16, 22)], [1, 2, 3, 4, 5].map((i) => req(`a${i}`, "A"))));
  assert.equal(s.assignments.length, 5);
});

test("السيناريو المرجعي: الجدول خالٍ من أي خرق للقيود الصلبة", () => {
  const p = buildReferenceScenario();
  const s = solve(p);
  assert.equal(countViolations(p, s).total, 0);
  assert.equal(s.assignments.length + s.unscheduled.length, p.requests.length);
});

test("سيناريو الضغط: المحرّك يتراجع فعلاً ثم يصل إلى جدول كامل صحيح", () => {
  const p = buildStressScenario();
  const s = solve(p);
  assert.ok(s.stats.backtracks > 0);
  assert.equal(s.assignments.length, p.requests.length);
  assert.equal(countViolations(p, s).total, 0);
});

test("إعادة الجدولة: إلغاء طلب لا يحرّك بقية الطلبات من مواضعها", () => {
  const p = buildReferenceScenario();
  const first = solve(p);
  const previous = new Map(first.assignments.map((a) => [a.requestId, { facilityId: a.facilityId, day: a.day, hour: a.hour }]));
  const cancelled = first.assignments[0].requestId;
  const p2 = { ...p, requests: p.requests.filter((r) => r.id !== cancelled) };
  const second = solve(p2, { previous });
  const moved = second.assignments.filter((a) => {
    const old = previous.get(a.requestId);
    return old && (old.facilityId !== a.facilityId || old.day !== a.day || old.hour !== a.hour);
  });
  assert.equal(moved.length, 0);
  assert.equal(countViolations(p2, second).total, 0);
});

test("فترة الإغلاق: لا يُسند أي طلب في ساعات إغلاق المرفق", () => {
  const p: Problem = { ...problem([pitch("F", 16, 20)], [req("r1", "A", "football", 0, 17), req("r2", "B")]), closures: [{ facilityId: "F", day: 0, fromHour: 16, toHour: 18 }] };
  const s = solve(p);
  assert.equal(s.assignments.length, 2);
  assert.ok(s.assignments.every((a) => a.hour >= 18));
  assert.equal(countViolations(p, s).total, 0);
});

test("الموعد المثبّت يبقى في مكانه ولو طلبه فريق آخر قبله", () => {
  const fixed = { facilityId: "F", day: 0, hour: 18 };
  const s = solve(problem([pitch("F", 17, 20)], [req("r1", "A", "football", 0, 18), { ...req("r2", "B"), fixed }]));
  const r2 = s.assignments.find((a) => a.requestId === "r2")!;
  assert.equal(r2.hour, 18);
  assert.equal(r2.fixed, true);
  assert.notEqual(s.assignments.find((a) => a.requestId === "r1")!.hour, 18);
});

test("الموعد المثبّت على فترة أُغلقت لاحقاً يُعاد جدولته بدل أن يُفقد", () => {
  const p: Problem = {
    ...problem([pitch("F", 17, 20)], [{ ...req("r1", "A"), fixed: { facilityId: "F", day: 0, hour: 18 } }]),
    closures: [{ facilityId: "F", day: 0, fromHour: 18, toHour: 19 }],
  };
  const s = solve(p);
  assert.equal(s.assignments.length, 1);
  assert.notEqual(s.assignments[0].hour, 18);
  assert.equal(s.assignments[0].reason, "fixed_lost");
});

test("فحص الموضع اليدوي يرفض الفترة المحجوزة والمغلقة ويقبل الحرّة", () => {
  const p: Problem = { ...problem([pitch("F", 17, 20)], [req("r1", "A"), req("r2", "B")]), closures: [{ facilityId: "F", day: 0, fromHour: 19, toHour: 20 }] };
  const s = solve(p);
  const r1 = s.assignments.find((a) => a.requestId === "r1")!;
  const r2 = p.requests[1];
  assert.equal(slotConflict(p, s.assignments, r2, r1)?.code, "slot_taken");
  assert.equal(slotConflict(p, s.assignments, r2, { facilityId: "F", day: 0, hour: 19 })?.code, "closed");
  const free = [17, 18].find((h) => !s.assignments.some((a) => a.hour === h));
  if (free !== undefined) assert.equal(slotConflict(p, s.assignments, r2, { facilityId: "F", day: 0, hour: free }), null);
});

test("إعادة الجدولة بعد إغلاق: يُنقل الحجز المتأثر وحده ولا يُزاح حجز قائم", () => {
  const p = buildReferenceScenario();
  const first = solve(p);
  const previous = new Map(first.assignments.map((a) => [a.requestId, { facilityId: a.facilityId, day: a.day, hour: a.hour }]));
  const hit = first.assignments.find((a) => a.facilityId === "F1")!;
  const p2 = { ...p, closures: [{ facilityId: "F1", day: hit.day, fromHour: hit.hour, toHour: hit.hour + 1 }] };
  const second = solve(p2, { previous });
  const moved = second.assignments.filter((a) => {
    const old = previous.get(a.requestId)!;
    return old.facilityId !== a.facilityId || old.day !== a.day || old.hour !== a.hour;
  });
  assert.equal(moved.length, 1);
  assert.equal(moved[0].requestId, hit.requestId);
  assert.equal(countViolations(p2, second).total, 0);
});
