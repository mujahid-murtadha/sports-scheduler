// السيناريو المرجعي: 4 مرافق، 20 فريقاً، 121 طلباً، أسبوع كامل. يُولَّد ببذرة ثابتة ليكون قابلاً للتكرار.
import type { Facility, Problem, Request, Team } from "../engine/types.ts";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DAY_NAMES = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

// أسماء افتراضية للبيانات التجريبية (لا تؤثر في نتائج المحرّك): خليط من الجهات التي تستأجر مجمّعاً رياضياً،
// أكاديميات بفئاتها العمرية، وفرق كليات جامعية، ومدارس، وأندية وفرق مجتمعية
const TEAM_NAMES: Record<string, string[]> = {
  football: [
    "أكاديمية الرواد (ناشئون)", "أكاديمية الرواد (شباب)", "أكاديمية المستقبل (براعم)",
    "كلية الحاسوب – النيلين", "كلية التجارة – النيلين", "كلية الهندسة – الخرطوم",
    "مدرسة الفجر الثانوية", "مركز شباب الحي", "فريق قدامى اللاعبين", "نادي الموظفين",
  ],
  basketball: ["أكاديمية القمة (ناشئون)", "أكاديمية القمة (شباب)", "كلية القانون – النيلين", "كلية الطب – الخرطوم", "سيدات جامعة الخرطوم", "مدرسة النهضة الثانوية"],
  volleyball: ["كلية الاقتصاد – الخرطوم", "كلية الآداب – النيلين", "نادي الهدف الرياضي", "مدرسة الفجر (بنات)"],
};

export function buildReferenceScenario(seed = 2026): Problem {
  const rand = rng(seed);
  const pickWeighted = (weights: number[]) => {
    let x = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i;
    return weights.length - 1;
  };

  const facilities: Facility[] = [
    { id: "F1", name: "الملعب الرئيسي", type: "football", openHour: 16, closeHour: 22 },
    { id: "F2", name: "ملعب التدريب", type: "football", openHour: 16, closeHour: 22 },
    { id: "F3", name: "صالة كرة السلة", type: "basketball", openHour: 16, closeHour: 22 },
    { id: "F4", name: "صالة الكرة الطائرة", type: "volleyball", openHour: 17, closeHour: 21 },
  ];

  // 10 فرق قدم، 6 سلة، 4 طائرة؛ ولكل نوع مدى لعدد الجلسات الأسبوعية المطلوبة
  const groups = [
    { type: "football", count: 10, min: 4, max: 7, open: 16, close: 22 },
    { type: "basketball", count: 6, min: 5, max: 9, open: 16, close: 22 },
    { type: "volleyball", count: 4, min: 5, max: 9, open: 17, close: 21 },
  ];
  const hourWeight: Record<number, number> = { 16: 1, 17: 2, 18: 4, 19: 4, 20: 3, 21: 1 }; // ذروة مسائية

  const teams: Team[] = [];
  const requests: Request[] = [];
  for (const g of groups) {
    for (let i = 1; i <= g.count; i++) {
      const team: Team = { id: `T${teams.length + 1}`, name: TEAM_NAMES[g.type][i - 1] };
      teams.push(team);
      const sessions = g.min + Math.floor(rand() * (g.max - g.min + 1));
      const used = new Set<string>();
      const hours = Array.from({ length: g.close - g.open }, (_, k) => g.open + k);
      while (used.size < sessions) {
        const day = Math.floor(rand() * 7);
        const hour = hours[pickWeighted(hours.map((h) => hourWeight[h]))];
        if (used.has(`${day}|${hour}`)) continue;
        used.add(`${day}|${hour}`);
        requests.push({ id: "", teamId: team.id, facilityType: g.type, preferred: { day, hour } });
      }
    }
  }
  // ترتيب وصول عشوائي (كما تصل الطلبات في الواقع)
  for (let i = requests.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [requests[i], requests[j]] = [requests[j], requests[i]];
  }
  requests.forEach((r, i) => (r.id = `R${i + 1}`));
  return { facilities, teams, requests, days: 7 };
}
