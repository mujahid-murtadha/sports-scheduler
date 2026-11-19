// محرّك الجدولة: نمذجة CSP + بحث بالتراجع (Backtracking) + فحص أمامي (Forward Checking)
// بلا أي مكتبة حل جاهزة.
import type { Assignment, Closure, Facility, Problem, Request, Schedule, SlotValue, Unscheduled } from "./types.ts";

const STEP_BUDGET = 200_000; // حد أقصى لخطوات البحث في المحاولة الواحدة

/** هل الفترة داخل إحدى فترات الإغلاق؟ */
export const isClosed = (closures: Closure[] = [], s: SlotValue) =>
  closures.some((c) => c.facilityId === s.facilityId && c.day === s.day && s.hour >= c.fromHour && s.hour < c.toHour);

/** توليد الفترات تلقائياً: كل ساعة تشغيل في كل يوم = قيمة ممكنة، عدا ساعات الإغلاق */
export function generateSlots(facilities: Facility[], days: number, closures: Closure[] = []): SlotValue[] {
  const slots: SlotValue[] = [];
  for (const f of facilities)
    for (let day = 0; day < days; day++)
      for (let hour = f.openHour; hour < f.closeHour; hour++)
        if (!isClosed(closures, { facilityId: f.id, day, hour })) slots.push({ facilityId: f.id, day, hour });
  return slots;
}

const slotKey = (s: SlotValue) => `${s.facilityId}|${s.day}|${s.hour}`;

/** أولوية العدالة: الجلسة رقم k لكل فريق تسبق الجلسة k+1 لأي فريق (ثم ترتيب الوصول) */
function fairnessPriority(requests: Request[]): Map<string, number> {
  const seen = new Map<string, number>();
  const prio = new Map<string, number>();
  requests.forEach((r, arrival) => {
    const round = seen.get(r.teamId) ?? 0;
    seen.set(r.teamId, round + 1);
    prio.set(r.id, round * 100_000 + arrival);
  });
  return prio;
}

export interface SolveOptions {
  /** مواضع الجدول السابق: عند إعادة الجدولة يُحاوَل إبقاء كل طلب في موضعه لتقليل التغيير */
  previous?: Map<string, SlotValue>;
}

export function solve(problem: Problem, options: SolveOptions = {}): Schedule {
  const { facilities, requests, days } = problem;
  const slots = generateSlots(facilities, days, problem.closures);
  const typeOf = new Map(facilities.map((f) => [f.id, f.type]));
  const prio = fairnessPriority(requests);

  // المواعيد المثبّتة: تُحترم إن بقيت صالحة (المرفق في الخدمة، النوع مطابق، الفترة غير مغلقة)،
  // وتُقدَّم على كل الطلبات. إن لم تعد صالحة يُعامل الطلب كأي طلب آخر.
  const slotIndex = new Map(slots.map((s, i) => [slotKey(s), i]));
  const fixedAt = new Map<string, number>();
  const taken = new Set<string>(); // يمنع تثبيتين متعارضين (حماية إضافية؛ الخادم يمنعهما أصلاً)
  for (const r of requests) {
    const i = r.fixed ? slotIndex.get(slotKey(r.fixed)) : undefined;
    if (i === undefined || typeOf.get(slots[i].facilityId) !== r.facilityType) continue;
    const s = slots[i];
    const keys = [slotKey(s), `team|${r.teamId}|${s.day}|${s.hour}`];
    if (keys.some((k) => taken.has(k))) continue;
    keys.forEach((k) => taken.add(k));
    fixedAt.set(r.id, i);
    prio.set(r.id, prio.get(r.id)! - 1_000_000_000);
  }
  const byPriority = (a: Request, b: Request) => prio.get(a.id)! - prio.get(b.id)!;

  const unscheduled: Unscheduled[] = [];
  const stats = { searchSteps: 0, backtracks: 0, relaxations: 0 };

  // (1) استبعاد مبكر: نوع غير موجود، أو طلبات تفوق الطاقة الاستيعابية للنوع
  let active: Request[] = [];
  const types = new Set(requests.map((r) => r.facilityType));
  for (const type of types) {
    const capacity = slots.filter((s) => typeOf.get(s.facilityId) === type).length;
    const ofType = requests.filter((r) => r.facilityType === type).sort(byPriority);
    ofType.forEach((r, i) => {
      if (capacity === 0)
        unscheduled.push({ requestId: r.id, teamId: r.teamId, reason: "no_type", reasonArgs: { type } });
      else if (i >= capacity)
        // الطلب يفوق الطاقة الاستيعابية للنوع؛ تُقدَّم الطلبات الأعلى أولوية وفق قاعدة العدالة
        unscheduled.push({ requestId: r.id, teamId: r.teamId, reason: "over_capacity", reasonArgs: { requests: ofType.length, capacity } });
      else active.push(r);
    });
  }

  // (2) البحث بالتراجع؛ إن ثبت تعذّر الحل نُسقط أدنى الطلبات أولوية ونعيد المحاولة
  let solution: Map<string, number> | null = null;
  while (true) {
    const attempt = backtrackingSearch(active, slots, typeOf, prio, stats, fixedAt, options.previous);
    if (attempt.solution) {
      solution = attempt.solution;
      break;
    }
    stats.relaxations++;
    const blockedType = attempt.blockedType!;
    const victim = active.filter((r) => r.facilityType === blockedType).sort(byPriority).pop()!;
    active = active.filter((r) => r.id !== victim.id);
    // تعذّر إيجاد فترة لا تتعارض مع جلسات الفريق نفسه أو مع الطلبات الأعلى أولوية
    unscheduled.push({ requestId: victim.id, teamId: victim.teamId, reason: "blocked" });
  }

  return { assignments: explain(problem, active, solution, slots, fixedAt), unscheduled, stats };
}

interface SearchResult {
  solution: Map<string, number> | null;
  blockedType?: string;
}

function backtrackingSearch(
  requests: Request[],
  slots: SlotValue[],
  typeOf: Map<string, string>,
  prio: Map<string, number>,
  stats: Schedule["stats"],
  fixedAt: Map<string, number>,
  previous?: Map<string, SlotValue>,
): SearchResult {
  // المجال الابتدائي لكل طلب: كل الفترات في المرافق المطابقة لنوعه (قيود النوع وساعات التشغيل والإغلاق مضمّنة هنا)
  // والطلب المثبّت مجاله قيمة واحدة: موعده
  const domains = new Map<string, number[]>();
  for (const r of requests)
    domains.set(
      r.id,
      fixedAt.has(r.id) ? [fixedAt.get(r.id)!] : slots.map((_, i) => i).filter((i) => typeOf.get(slots[i].facilityId) === r.facilityType),
    );

  const assigned = new Map<string, number>();
  const load = new Map<string, number>(); // عدد الجلسات المسندة لكل مرفق (لتوزيع الحمل بين المرافق المتماثلة)
  const wipeouts = new Map<string, number>(); // كم مرة أُفرغ مجال كل نوع (لتحديد موضع الاختناق)
  let steps = 0;

  // عند إعادة الجدولة: الموضع السابق لكل طلب، ومن يملك كل موضع (لتجنّب إزاحة حجز قائم ما دام هناك بديل حرّ)
  const ids = new Set(requests.map((r) => r.id));
  const previousOwner = new Map<string, string>();
  for (const [id, s] of previous ?? []) if (ids.has(id)) previousOwner.set(slotKey(s), id);

  // ترتيب القيم: الموضع السابق، ثم الوقت المفضّل فالأقرب إليه، مع تأخير المواضع التي يشغلها حجز قائم لطلب آخر
  const distance = (r: Request, v: SlotValue) => {
    const prev = previous?.get(r.id);
    if (prev && prev.facilityId === v.facilityId && prev.day === v.day && prev.hour === v.hour) return -1;
    const owner = previousOwner.get(slotKey(v));
    return preferredDistance(r, v) + (owner && owner !== r.id ? 1000 : 0);
  };
  const preferredDistance = (r: Request, v: SlotValue) =>
    r.preferred ? Math.abs(v.day - r.preferred.day) * 100 + Math.abs(v.hour - r.preferred.hour) : v.day * 100 + v.hour;

  function search(): boolean {
    if (assigned.size === requests.length) return true;
    if (++steps > STEP_BUDGET) return false;

    // MRV: نختار الطلب الأقل خيارات (وعند التساوي الأعلى أولوية)
    let current: Request | null = null;
    for (const r of requests) {
      if (assigned.has(r.id)) continue;
      if (
        !current ||
        domains.get(r.id)!.length < domains.get(current.id)!.length ||
        (domains.get(r.id)!.length === domains.get(current.id)!.length && prio.get(r.id)! < prio.get(current.id)!)
      )
        current = r;
    }
    const req = current!;
    // عند تساوي القرب من الوقت المفضّل يُقدَّم المرفق الأقل حملاً
    const candidates = [...domains.get(req.id)!].sort(
      (a, b) =>
        distance(req, slots[a]) - distance(req, slots[b]) ||
        (load.get(slots[a].facilityId) ?? 0) - (load.get(slots[b].facilityId) ?? 0),
    );

    for (const v of candidates) {
      const chosen = slots[v];
      assigned.set(req.id, v);
      load.set(chosen.facilityId, (load.get(chosen.facilityId) ?? 0) + 1);

      // الفحص الأمامي: نحذف من مجالات الطلبات الباقية ما صار مستحيلاً
      const saved = new Map<string, number[]>();
      let deadEnd = false;
      for (const other of requests) {
        if (assigned.has(other.id)) continue;
        const dom = domains.get(other.id)!;
        const filtered = dom.filter((i) => {
          const s = slots[i];
          if (i === v) return false; // قيد: لا مرفق واحد لطلبين في الفترة نفسها
          if (other.teamId === req.teamId && s.day === chosen.day && s.hour === chosen.hour) return false; // قيد: الفريق لا يكون في مكانين معاً
          return true;
        });
        if (filtered.length !== dom.length) {
          saved.set(other.id, dom);
          domains.set(other.id, filtered);
          if (filtered.length === 0) {
            deadEnd = true;
            wipeouts.set(other.facilityType, (wipeouts.get(other.facilityType) ?? 0) + 1);
            break;
          }
        }
      }

      if (!deadEnd && search()) return true;

      // التراجع: نلغي الإسناد ونعيد المجالات كما كانت
      for (const [id, dom] of saved) domains.set(id, dom);
      assigned.delete(req.id);
      load.set(chosen.facilityId, load.get(chosen.facilityId)! - 1);
      stats.backtracks++;
    }
    return false;
  }

  const ok = search();
  stats.searchSteps += steps;
  if (ok) return { solution: assigned };
  const blockedType =
    [...wipeouts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? requests[requests.length - 1].facilityType;
  return { solution: null, blockedType };
}

/** تفسير القرارات: لماذا وُضع كل طلب في موضعه */
function explain(
  problem: Problem,
  requests: Request[],
  solution: Map<string, number>,
  slots: SlotValue[],
  fixedAt: Map<string, number>,
): Assignment[] {
  const teamName = new Map(problem.teams.map((t) => [t.id, t.name]));
  const typeOf = new Map(problem.facilities.map((f) => [f.id, f.type]));
  const reqById = new Map(requests.map((r) => [r.id, r]));
  const placed = [...solution.entries()].map(([id, v]) => ({ req: reqById.get(id)!, slot: slots[v] }));

  return placed.map(({ req, slot }) => {
    const p = req.preferred;
    const matched = !!p && p.day === slot.day && p.hour === slot.hour;
    const fixed = fixedAt.has(req.id);
    let reason: string;
    let reasonArgs: Assignment["reasonArgs"];
    if (fixed) reason = "fixed"; // موعد مثبّت من الإدارة
    else if (req.fixed) reason = "fixed_lost"; // الموعد المثبّت لم يعد متاحاً؛ أُسندت أقرب فترة بديلة
    else if (!p) reason = "no_pref"; // لا وقت مفضّل؛ أول فترة متاحة
    else if (matched) reason = "matched"; // لُبّي الوقت المفضّل
    else {
      const atPreferred = placed.filter((o) => o.slot.day === p.day && o.slot.hour === p.hour);
      const occupants = atPreferred
        .filter((o) => o.req.teamId !== req.teamId && typeOf.get(o.slot.facilityId) === req.facilityType)
        .map((o) => teamName.get(o.req.teamId) ?? o.req.teamId);
      if (atPreferred.some((o) => o.req.teamId === req.teamId)) reason = "team_busy"; // للفريق جلسة أخرى في وقته المفضّل
      else if (occupants.length) { reason = "taken"; reasonArgs = { teams: [...new Set(occupants)] }; } // الوقت المفضّل مشغول بفرق أخرى
      else reason = "unavailable"; // الوقت المفضّل خارج ساعات التشغيل أو مغلق
    }
    return { requestId: req.id, teamId: req.teamId, ...slot, matchedPreference: matched, fixed, reason, reasonArgs };
  });
}
