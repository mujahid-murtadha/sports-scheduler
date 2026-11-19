// تشغيل سيناريو الضغط وإظهار عمل التراجع
import { computeMetrics, countViolations } from "./engine/metrics.ts";
import { solve } from "./engine/scheduler.ts";
import { buildStressScenario } from "./scenario/stress.ts";

const problem = buildStressScenario();
const t0 = performance.now();
const schedule = solve(problem);
const ms = performance.now() - t0;
const m = computeMetrics(problem, schedule);
console.log(`سيناريو الضغط: ${problem.requests.length} طلباً على ${problem.requests.length} فترة (امتلاء 100%)، ${problem.teams.length} أندية`);
console.log(`المجدول: ${m.scheduled}/${m.totalRequests} | الخروقات: ${countViolations(problem, schedule).total} | الزمن: ${ms.toFixed(2)} ms`);
console.log(`خطوات البحث: ${schedule.stats.searchSteps} | الإسنادات الملغاة (تراجع): ${schedule.stats.backtracks}`);
