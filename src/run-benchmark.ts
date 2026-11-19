// تشغيل السيناريو المرجعي ومقارنة المحرّك بمحاكاة الجدولة اليدوية
import { writeFileSync } from "node:fs";
import { scheduleFcfs } from "./baseline/fcfs.ts";
import { computeMetrics, countViolations } from "./engine/metrics.ts";
import { generateSlots, solve } from "./engine/scheduler.ts";
import { buildReferenceScenario } from "./scenario/reference.ts";

const problem = buildReferenceScenario();
const RUNS = 30;

function timed<T>(fn: () => T) {
  const times: number[] = [];
  let result!: T;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { result, medianMs: times[Math.floor(RUNS / 2)] };
}

const engine = timed(() => solve(problem));
const manual = timed(() => scheduleFcfs(problem));
const em = computeMetrics(problem, engine.result);
const mm = computeMetrics(problem, manual.result);
const pct = (x: number) => (x * 100).toFixed(1) + "%";

const perType = [...new Set(problem.facilities.map((f) => f.type))].map((type) => ({
  type,
  capacity: generateSlots(problem.facilities.filter((f) => f.type === type), problem.days).length,
  requests: problem.requests.filter((r) => r.facilityType === type).length,
}));

console.log("السيناريو:", problem.facilities.length, "مرافق |", problem.teams.length, "فريقاً |", problem.requests.length, "طلباً");
console.table(perType);
console.table({
  "التعارضات": { engine: em.conflicts, manual: mm.conflicts },
  "الطلبات المجدولة": { engine: `${em.scheduled}/${em.totalRequests}`, manual: `${mm.scheduled}/${mm.totalRequests}` },
  "نسبة التلبية": { engine: pct(em.fulfilmentRate), manual: pct(mm.fulfilmentRate) },
  "معدل الاستغلال": { engine: pct(em.utilization), manual: pct(mm.utilization) },
  "مؤشر العدالة (Jain)": { engine: em.fairnessIndex.toFixed(3), manual: mm.fairnessIndex.toFixed(3) },
  "أدنى نسبة تلبية لفريق": { engine: pct(em.minTeamRatio), manual: pct(mm.minTeamRatio) },
  "تلبية الوقت المفضّل": { engine: pct(em.preferenceRate), manual: pct(mm.preferenceRate) },
  "زمن التوليد (ms، وسيط)": { engine: engine.medianMs.toFixed(2), manual: manual.medianMs.toFixed(2) },
});
console.log("تفاصيل التحقق (المحرّك):", countViolations(problem, engine.result));
console.log("إحصاءات البحث:", engine.result.stats);
const reasons = new Map<string, number>();
for (const u of engine.result.unscheduled) {
  const key = u.reason.replace(/\d+/g, "N");
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
console.log("أسباب عدم الجدولة:", Object.fromEntries(reasons));

writeFileSync(
  new URL("../results/benchmark.json", import.meta.url),
  JSON.stringify({ perType, engine: { metrics: em, medianMs: engine.medianMs, stats: engine.result.stats }, manual: { metrics: mm, medianMs: manual.medianMs }, schedule: engine.result }, null, 2),
);
