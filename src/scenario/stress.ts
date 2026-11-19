// سيناريو الضغط: بطولة نهاية أسبوع تملأ المرافق 100%، وكل نادٍ يلعب في الأنواع الثلاثة.
// الغرض: إظهار التراجع (Backtracking) — هنا لا يكفي الفحص الأمامي وحده للوصول إلى الحل.
import type { Facility, Problem, Request, Team } from "../engine/types.ts";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildStressScenario(seed = 26): Problem {
  const rand = rng(seed);
  const facilities: Facility[] = [
    { id: "F1", name: "ملعب كرة القدم (أ)", type: "football", openHour: 18, closeHour: 21 },
    { id: "F2", name: "ملعب كرة القدم (ب)", type: "football", openHour: 18, closeHour: 21 },
    { id: "F3", name: "صالة كرة السلة", type: "basketball", openHour: 18, closeHour: 21 },
    { id: "F4", name: "صالة الكرة الطائرة", type: "volleyball", openHour: 18, closeHour: 21 },
  ];
  const days = 2;
  const teams: Team[] = Array.from({ length: 6 }, (_, i) => ({ id: `C${i + 1}`, name: `نادي ${i + 1}` }));
  const requests: Request[] = [];
  // 6 أندية × (2 قدم + 1 سلة + 1 طائرة) = 24 طلباً على 24 فترة بالضبط
  for (const t of teams)
    for (const type of ["football", "football", "basketball", "volleyball"])
      requests.push({ id: "", teamId: t.id, facilityType: type, preferred: { day: Math.floor(rand() * days), hour: 18 + Math.floor(rand() * 3) } });
  for (let i = requests.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [requests[i], requests[j]] = [requests[j], requests[i]];
  }
  requests.forEach((r, i) => (r.id = `R${i + 1}`));
  return { facilities, teams, requests, days };
}
