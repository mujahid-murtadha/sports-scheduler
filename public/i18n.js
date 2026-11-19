// اللغة: العربية (من اليمين لليسار) أو الإنجليزية (من اليسار لليمين)
// يُحمَّل في رأس كل صفحة قبل عرضها، فتنعكس الصفحة دون وميض.
const LANG = (() => { try { return localStorage.getItem("lang") === "en" ? "en" : "ar"; } catch { return "ar"; } })();
document.documentElement.lang = LANG;
document.documentElement.dir = LANG === "en" ? "ltr" : "rtl";

/** النص باللغة الحالية: tr("عربي", "English") */
const tr = (ar, en) => (LANG === "en" ? en : ar);
const LOCALE = LANG === "en" ? "en-GB" : "ar-EG-u-nu-latn";

function setLang(lang) {
  try { localStorage.setItem("lang", lang); } catch { /* يبقى الاختيار لهذه الصفحة فقط */ }
  location.reload();
}

// النصوص الثابتة في HTML: العنصر يحمل نصه الإنجليزي في data-en، ووصفه في data-en-label
document.addEventListener("DOMContentLoaded", () => {
  if (LANG !== "en") return;
  document.querySelectorAll("[data-en]").forEach((el) => (el.textContent = el.dataset.en));
  document.querySelectorAll("[data-en-label]").forEach((el) => {
    el.setAttribute("aria-label", el.dataset.enLabel);
    if (el.hasAttribute("title")) el.title = el.dataset.enLabel;
  });
  document.querySelectorAll("[data-en-placeholder]").forEach((el) => (el.placeholder = el.dataset.enPlaceholder));
});

const DAYS = tr(
  ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"],
  ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
);
const TYPES = {
  football: tr("كرة القدم", "Football"),
  basketball: tr("كرة السلة", "Basketball"),
  volleyball: tr("الكرة الطائرة", "Volleyball"),
  tennis: tr("التنس", "Tennis"),
  handball: tr("كرة اليد", "Handball"),
};
const typeLabel = (t) => TYPES[t] ?? t;
const hourText = (h) => `${String(h).padStart(2, "0")}:00`;
// عزل الاتجاه لأسماء البيانات داخل الجمل (يمنع انقلاب الأقواس عند خلط العربية والإنجليزية)
const iso = (s) => `\u2068${s ?? ""}\u2069`;
const listJoin = (items) => items.map(iso).join(tr("، ", ", "));

// العدد مع المعدود: العربية لها صيغ للمفرد والمثنى والجمع والتمييز، والإنجليزية مفرد وجمع
const NOUNS = {
  request: [["طلب واحد", "طلبان", "طلبات", "طلباً"], ["request", "requests"]],
  booking: [["حجز واحد", "حجزان", "حجوزات", "حجزاً"], ["booking", "bookings"]],
  slot: [["فترة واحدة", "فترتان", "فترات", "فترة"], ["slot", "slots"]],
  team: [["فريق واحد", "فريقان", "فرق", "فريقاً"], ["team", "teams"]],
  facility: [["مرفق واحد", "مرفقان", "مرافق", "مرفقاً"], ["facility", "facilities"]],
  session: [["جلسة واحدة", "جلستان", "جلسات", "جلسة"], ["session", "sessions"]],
  closure: [["فترة إغلاق", "فترتا إغلاق", "فترات إغلاق", "فترة إغلاق"], ["closure", "closures"]],
};
function count(n, noun) {
  const [ar, en] = NOUNS[noun];
  if (LANG === "en") return `${n} ${n === 1 ? en[0] : en[1]}`;
  if (n === 1) return ar[0];
  if (n === 2) return ar[1];
  return `${n} ${n >= 3 && n <= 10 ? ar[2] : ar[3]}`;
}

// تفسير قرارات المحرّك: المحرّك يرسل رمز السبب ومعطياته، وهنا تُصاغ الجملة
const REASONS = {
  matched: () => tr("لُبّي الوقت المفضّل", "Preferred time granted"),
  no_pref: () => tr("لا يوجد وقت مفضّل؛ أُسندت أول فترة متاحة", "No preferred time; the first available slot was assigned"),
  taken: (a) => tr(`الوقت المفضّل مشغول (${listJoin(a.teams ?? [])})؛ أُسندت أقرب فترة متاحة`, `Preferred time taken by ${listJoin(a.teams ?? [])}; the nearest available slot was assigned`),
  team_busy: () => tr("للفريق جلسة أخرى في الوقت المفضّل؛ أُسندت أقرب فترة متاحة", "The team has another session at its preferred time; the nearest available slot was assigned"),
  unavailable: () => tr("الوقت المفضّل خارج ساعات التشغيل أو مغلق؛ أُسندت أقرب فترة متاحة", "The preferred time is outside operating hours or closed; the nearest available slot was assigned"),
  fixed: () => tr("موعد مثبّت من الإدارة", "Time fixed by the administration"),
  fixed_lost: () => tr("الموعد المثبّت لم يعد متاحاً (إغلاق أو تعديل في المرفق)؛ أُسندت أقرب فترة بديلة", "The fixed time is no longer available (closure or facility change); moved to the nearest alternative"),
  manual: () => tr("جدولة يدوية من الإدارة", "Booked manually by the administration"),
  no_type: (a) => tr(`لا يوجد مرفق من النوع المطلوب (${typeLabel(a.type)})`, `No facility of the requested type (${typeLabel(a.type)})`),
  over_capacity: (a) => tr(
    `الطلب يفوق الطاقة الاستيعابية: ${a.requests} طلباً على ${a.capacity} فترة متاحة لهذا النوع، وقُدّمت الطلبات الأعلى أولوية وفق قاعدة العدالة`,
    `Demand exceeds capacity: ${a.requests} requests for ${a.capacity} available slots of this type; higher-priority requests were served first under the fairness rule`),
  blocked: () => tr("تعذّر إيجاد فترة لا تتعارض مع جلسات الفريق نفسه أو مع الطلبات الأعلى أولوية", "No slot avoids clashing with the team's own sessions or with higher-priority requests"),
};
const reasonText = (code, args) => (REASONS[code] ? REASONS[code](args ?? {}) : code);

// سجل النشاط: الخادم يحفظ رمز العملية وتفاصيلها
const at = (p) => `${DAYS[p.day]} ${hourText(p.hour)}`;
const span2 = (p) => `${DAYS[p.day]} ${hourText(p.from)}–${hourText(p.to)}`;
const ACTIVITY = {
  facility_added: (p) => tr(`أضاف المرفق «${iso(p.name)}»`, `Added facility “${iso(p.name)}”`),
  facility_edited: (p) => tr(`عدّل بيانات المرفق «${iso(p.name)}»`, `Edited facility “${iso(p.name)}”`),
  facility_activated: (p) => tr(`أعاد المرفق «${iso(p.name)}» إلى الخدمة`, `Returned “${iso(p.name)}” to service`),
  facility_deactivated: (p) => tr(`أخرج المرفق «${iso(p.name)}» من الخدمة`, `Took “${iso(p.name)}” out of service`),
  facility_deleted: (p) => tr(`حذف المرفق «${iso(p.name)}»`, `Deleted facility “${iso(p.name)}”`),
  closure_added: (p) => tr(`أغلق «${iso(p.facility)}» يوم ${span2(p)} (${iso(p.reason)})`, `Closed “${iso(p.facility)}” on ${span2(p)} (${iso(p.reason)})`),
  closure_removed: (p) => tr(`ألغى إغلاق «${iso(p.facility)}» يوم ${span2(p)}`, `Removed the closure of “${iso(p.facility)}” on ${span2(p)}`),
  team_added: (p) => tr(`سجّل الفريق «${iso(p.name)}»`, `Registered team “${iso(p.name)}”`),
  team_edited: (p) => tr(`عدّل بيانات الفريق «${iso(p.name)}»`, `Edited team “${iso(p.name)}”`),
  team_deleted: (p) => tr(`حذف الفريق «${iso(p.name)}» وطلباته`, `Deleted team “${iso(p.name)}” and its requests`),
  requests_added: (p) => {
    const when = p.day === null || p.day === undefined ? "" : tr(`، ${at(p)}`, `, ${at(p)}`);
    return tr(`سجّل ${p.count === 1 ? "طلب حجز" : `${p.count} طلبات حجز`} للفريق «${iso(p.team)}» (${typeLabel(p.type)}${when})`,
      `Added ${p.count === 1 ? "a booking request" : `${p.count} booking requests`} for “${iso(p.team)}” (${typeLabel(p.type)}${when})`);
  },
  request_cancelled: (p) => tr(`ألغى الطلب ${p.id} للفريق «${iso(p.team)}»`, `Cancelled request ${p.id} for “${iso(p.team)}”`),
  manual_booking: (p) => tr(`حجز يدوياً للفريق «${iso(p.team)}»: ${iso(p.facility)}، ${at(p)} (الطلب ${p.id})`, `Manually booked “${iso(p.team)}”: ${iso(p.facility)}, ${at(p)} (request ${p.id})`),
  fixed_on: (p) => tr(`ثبّت حجز الفريق «${iso(p.team)}» يوم ${at(p)} (الطلب ${p.id})`, `Fixed the booking of “${iso(p.team)}” on ${at(p)} (request ${p.id})`),
  fixed_off: (p) => tr(`ألغى تثبيت حجز الفريق «${iso(p.team)}» يوم ${at(p)} (الطلب ${p.id})`, `Unfixed the booking of “${iso(p.team)}” on ${at(p)} (request ${p.id})`),
  schedule_run: (p) => tr(`شغّل الجدولة (مؤكَّد: ${p.scheduled}، غير ملبّى: ${p.unscheduled}، نُقل: ${p.moved})`, `Generated the schedule (confirmed: ${p.scheduled}, unmet: ${p.unscheduled}, moved: ${p.moved})`),
  settings_updated: (p) => tr(`حدّث الإعدادات (لوحة العرض العامة: ${p.board ? "مفعّلة" : "متوقفة"})`, `Updated settings (public board: ${p.board ? "on" : "off"})`),
  password_changed: () => tr("غيّر كلمة المرور", "Changed the password"),
  user_added: (p) => tr(`أضاف المستخدم «${iso(p.name)}» (${iso(p.username)})`, `Added user “${iso(p.name)}” (${iso(p.username)})`),
  user_deleted: (p) => tr(`حذف المستخدم «${iso(p.name)}» (${iso(p.username)})`, `Deleted user “${iso(p.name)}” (${iso(p.username)})`),
  demo_loaded: () => tr("حمّل البيانات التجريبية (4 مرافق، 20 فريقاً، 121 طلباً)", "Loaded the demo data (4 facilities, 20 teams, 121 requests)"),
  data_cleared: () => tr("حذف جميع بيانات المرافق والفرق والطلبات", "Deleted all facilities, teams and requests"),
};
const activityText = (code, params) => (ACTIVITY[code] ? ACTIVITY[code](params ?? {}) : code);
