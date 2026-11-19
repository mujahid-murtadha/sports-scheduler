// واجهة نسق: تجلب الحالة من الخادم، تعرض الصفحات، وترسل أوامر الإدارة والجدولة
// البنية: (1) أدوات (2) الحالة والحسابات (3) الصفحات (4) اللوح الجانبي والنوافذ (5) الأحداث
// النصوص بالعربية والإنجليزية عبر tr("عربي", "English") من i18n.js

// ======================= (1) أدوات =======================
const PAGES = {
  dashboard: tr("لوحة المتابعة", "Dashboard"), schedule: tr("الجدول", "Schedule"), requests: tr("طلبات الحجز", "Booking requests"),
  teams: tr("الفرق", "Teams"), facilities: tr("المرافق", "Facilities"), reports: tr("التقارير", "Reports"),
  activity: tr("سجل النشاط", "Activity log"), settings: tr("الإعدادات", "Settings"),
};
const CLOSURE_REASONS = tr(["صيانة", "مباراة رسمية", "فعالية", "تجهيز الأرضية"], ["Maintenance", "Official match", "Event", "Surface works"]);

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// نص من بيانات المستخدم (اسم فريق أو مرفق): يُعزل اتجاهه فلا تنقلب أقواسه داخل واجهة الاتجاه الآخر
const nm = (s) => `<bdi>${esc(s)}</bdi>`;
const icon = (name, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="icons.svg#i-${name}"/></svg>`;
const kind = (type) => (TYPES[type] ? type : "football");
const court = (type, cls = "") => `<svg class="court ${cls}" viewBox="0 0 120 80" style="color:var(--${kind(type)})" aria-hidden="true"><use href="icons.svg#court-${kind(type)}"/></svg>`;
const span = (h1, h2) => `<span class="num">${hourText(h1)}–${hourText(h2)}</span>`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const todayIndex = () => (new Date().getDay() + 1) % 7; // السبت = 0
const fmt = (iso, opts) => new Intl.DateTimeFormat(LOCALE, opts).format(new Date(iso));
const dateTime = (iso) => fmt(iso, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const phoneText = (p) => (p && /^\d{10}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p ?? "");
// حرف الفريق: أول كلمة مميّزة بعد الكلمات العامة (أكاديمية الرواد = ر، كلية الحاسوب = ح)
const GENERIC = new Set(["أكاديمية", "منتخب", "كلية", "مدرسة", "فريق", "مركز", "نادي", "سيدات", "جامعة"]);
const initial = (name) => {
  const words = String(name ?? "").replace(/[()–-]/g, " ").split(/\s+/).filter((w) => w && !GENERIC.has(w));
  return esc((words[0] ?? String(name ?? "")).replace(/^ال/, "").charAt(0));
};

// ======================= (2) الحالة والحسابات =======================
let S = null; // الحالة كما يرسلها الخادم
const X = {}; // فهارس مشتقة تُحدَّث بعد كل استجابة
const ui = {
  sched: { mode: "day", day: todayIndex(), facility: null, team: null },
  req: { status: "all", type: "all", q: "" },
  drawer: null,
};

function buildIndex() {
  X.team = new Map(S.teams.map((t) => [t.id, t]));
  X.fac = new Map(S.facilities.map((f) => [f.id, f]));
  X.req = new Map(S.requests.map((r) => [r.id, r]));
  X.asg = new Map(S.assignments.map((a) => [a.request_id, a]));
  X.uns = new Map(S.unscheduled.map((u) => [u.request_id, u]));
  X.at = new Map(S.assignments.map((a) => [`${a.facility_id}|${a.day}|${a.hour}`, a]));
  X.teamType = new Map();
  for (const r of S.requests) if (!X.teamType.has(r.team_id)) X.teamType.set(r.team_id, r.facility_type);
}

const closureAt = (fid, day, hour) => S.closures.find((c) => c.facility_id === fid && c.day === day && hour >= c.from_hour && hour < c.to_hour);
const isOpen = (f, day, hour) => f.active && hour >= f.open_hour && hour < f.close_hour && !closureAt(f.id, day, hour);
function capacity(f) {
  let n = 0;
  for (let d = 0; d < 7; d++) for (let h = f.open_hour; h < f.close_hour; h++) if (isOpen(f, d, h)) n++;
  return n;
}
const sessionsOn = (f) => S.assignments.filter((a) => a.facility_id === f.id).length;
const teamColor = (teamId) => `var(--${X.teamType.get(teamId) ?? "football"})`;
const prefText = (r) => (r.pref_day === null ? tr("بلا تفضيل", "No preference") : `${DAYS[r.pref_day]} <span class="num">${hourText(r.pref_hour)}</span>`);
// رسم المرفق: الملعب الثاني من النوع نفسه يأخذ رسم ملعب التدريب
const artFor = (f) => {
  const nth = S.facilities.filter((x) => x.type === f.type && x.id < f.id).length;
  return f.type === "football" && nth % 2 === 1 ? "football-2" : kind(f.type);
};

function statusOf(r) {
  const a = X.asg.get(r.id);
  if (a) return a.fixed ? { kind: "fixed", label: tr("مثبّت", "Fixed"), a } : { kind: "ok", label: tr("مؤكَّد", "Confirmed"), a };
  const u = X.uns.get(r.id);
  if (u) return { kind: "no", label: tr("غير ملبّى", "Unmet"), u };
  return { kind: "new", label: tr("جديد", "New") };
}
const statusTag = (s) => `<span class="tag ${s.kind}">${s.kind === "fixed" ? icon("lock") : ""}${s.label}</span>`;

/** حجز لم يعد صالحاً بعد تعديل البيانات (إغلاق، إيقاف مرفق، تغيير ساعات أو نوع) */
function invalidReason(a) {
  const f = X.fac.get(a.facility_id);
  const r = X.req.get(a.request_id);
  if (!f.active) return tr("المرفق خارج الخدمة", "Facility out of service");
  if (closureAt(f.id, a.day, a.hour)) return tr("يقع في فترة إغلاق", "Falls in a closure");
  if (a.hour < f.open_hour || a.hour >= f.close_hour) return tr("خارج ساعات تشغيل المرفق", "Outside facility hours");
  if (r && r.facility_type !== f.type) return tr("نوع المرفق تغيّر", "Facility type changed");
  return null;
}
function staleness() {
  const pending = S.requests.filter((r) => !X.asg.has(r.id) && !X.uns.has(r.id)).length;
  const invalid = S.assignments.filter((a) => invalidReason(a)).length;
  return { pending, invalid, any: pending + invalid > 0 };
}

/** الطلبات غير المجدولة التي يمكن وضعها في فترة حرّة معيّنة */
function candidatesFor(f, day, hour) {
  return S.requests.filter((r) => {
    if (X.asg.has(r.id) || r.facility_type !== f.type) return false;
    return !S.assignments.some((a) => a.team_id === r.team_id && a.day === day && a.hour === hour);
  });
}

/** مؤشر Jain للعدالة على نسب تلبية الفرق الحالية */
function fairness() {
  const asked = new Map(), got = new Map();
  for (const r of S.requests) asked.set(r.team_id, (asked.get(r.team_id) ?? 0) + 1);
  for (const a of S.assignments) got.set(a.team_id, (got.get(a.team_id) ?? 0) + 1);
  const x = [...asked].map(([t, n]) => (got.get(t) ?? 0) / n);
  const sum = x.reduce((s, v) => s + v, 0), sq = x.reduce((s, v) => s + v * v, 0);
  return sq ? (sum * sum) / (x.length * sq) : 0;
}

// ======================= الاتصال بالخادم =======================
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json", "X-Lang": LANG }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.replace("/login.html"); throw new Error("401"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? tr("تعذّر الاتصال بالخادم", "Couldn't reach the server"));
  return data;
}

/** تنفيذ أمر يعيد الحالة كاملة، ثم إعادة العرض ورسالة تأكيد */
async function act(method, path, body, done) {
  try {
    S = await api(method, path, body);
    render();
    if (done) toast(typeof done === "function" ? done(S) : done);
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("#toast");
  el.innerHTML = `${icon(isError ? "alert" : "check")}<span>${esc(message)}</span>`;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 4200);
}

// ======================= (3) الصفحات =======================
const currentPage = () => (PAGES[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard");

function render() {
  buildIndex();
  const page = currentPage();
  document.querySelectorAll("#nav a").forEach((a) =>
    a.getAttribute("href") === `#${page}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  $("#page-title").textContent = PAGES[page];
  $("#page-sub").innerHTML = nm(S.settings.orgName);
  document.title = `${PAGES[page]} | ${tr("نسق", "Nasaq")}`;
  $("#me-name").innerHTML = nm(S.user.fullName);
  $("#me-login").textContent = S.user.username;
  $("#me-initial").textContent = S.user.fullName.trim().charAt(0);

  const st = staleness();
  const waiting = S.requests.filter((r) => !X.asg.has(r.id)).length;
  $("#nav-count").hidden = waiting === 0;
  $("#nav-count").textContent = waiting;
  $("#run-dot").hidden = !st.any;
  const parts = [];
  if (st.pending) parts.push(`${tr("طلبات لم تدخل الجدول بعد", "Requests not yet in the schedule")}: <b class="num">${st.pending}</b>`);
  if (st.invalid) parts.push(`${tr("حجوزات لم تعد صالحة بعد تعديل المرافق", "Bookings no longer valid after facility changes")}: <b class="num">${st.invalid}</b>`);
  $("#stale").hidden = !st.any;
  $("#stale").innerHTML = st.any
    ? `${icon("alert")}<span>${parts.join(tr("، ", ", "))}. ${tr("شغّل الجدولة لتحديث الجدول؛ تبقى بقية الحجوزات في مواعيدها.", "Generate the schedule to update it; all other bookings keep their times.")}</span>`
    : "";

  $("#page").innerHTML = VIEWS[page]();
  if (page === "requests") renderRequestList();
  renderDrawer();
}

function emptyState(type, title, text, actions = "") {
  return `<div class="panel empty">${court(type)}<h3>${title}</h3><p>${text}</p>${actions ? `<div class="toolbar" style="justify-content:center;margin:4px 0 0">${actions}</div>` : ""}</div>`;
}
const noFacilities = () =>
  emptyState("football", tr("لا توجد مرافق مسجّلة", "No facilities yet"),
    tr("سجّل الملاعب والصالات وساعات عملها، ثم الفرق وطلباتها، وشغّل الجدولة.", "Register your pitches and halls with their hours, then teams and their requests, and generate the schedule."),
    `<a class="btn" href="#facilities">${icon("plus")}${tr("تسجيل المرافق", "Add facilities")}</a><button class="btn-quiet" data-action="load-demo">${tr("تحميل بيانات تجريبية", "Load demo data")}</button>`);

// ---------- لوحة المتابعة ----------
function dashboard() {
  if (!S.facilities.length) return noFacilities();
  const active = S.facilities.filter((f) => f.active);
  const cap = active.reduce((s, f) => s + capacity(f), 0);
  const booked = S.assignments.length;
  const st = staleness();

  const summary = `
    <section class="panel summary" aria-label="${tr("ملخص الأسبوع", "Week summary")}">
      <div><div class="label">${tr("الحجوزات المؤكدة", "Confirmed bookings")}</div><div class="value num">${booked}</div><div class="note">${tr(`من ${count(S.requests.length, "request")}`, `of ${count(S.requests.length, "request")}`)}</div></div>
      <div><div class="label">${tr("إشغال المرافق", "Facility occupancy")}</div><div class="value num">${cap ? pct(booked / cap) : "0%"}</div><div class="note">${tr(`${booked} من ${count(cap, "slot")} متاحة`, `${booked} of ${count(cap, "slot")} available`)}</div></div>
      <div><div class="label">${tr("عدالة التوزيع بين الفرق", "Fairness across teams")}</div><div class="value num">${S.requests.length ? fairness().toFixed(3) : "–"}</div><div class="note">${tr("مؤشر Jain، والقيمة 1 تعني تساوياً تاماً", "Jain's index; 1 means perfectly equal")}</div></div>
      <div><div class="label">${tr("طلبات غير ملبّاة", "Unmet requests")}</div><div class="value num">${S.unscheduled.length}</div><div class="note">${st.pending ? tr(`و${count(st.pending, "request")} بانتظار الجدولة`, `plus ${count(st.pending, "request")} awaiting scheduling`) : tr("لم يتوفر لها موعد", "No slot was available")}</div></div>
    </section>`;

  // خريطة الإشغال: يوم × ساعة
  const hours = active.length ? [Math.min(...active.map((f) => f.open_hour)), Math.max(...active.map((f) => f.close_hour))] : [16, 22];
  let heat = `<thead><tr><th></th>${DAYS.map((d, i) => `<th scope="col">${i === todayIndex() ? `<b>${d}</b>` : d}</th>`).join("")}</tr></thead><tbody>`;
  for (let h = hours[0]; h < hours[1]; h++) {
    heat += `<tr><th scope="row" class="num">${hourText(h)}</th>`;
    for (let d = 0; d < 7; d++) {
      const open = active.filter((f) => isOpen(f, d, h)).length;
      const used = S.assignments.filter((a) => a.day === d && a.hour === h && X.fac.get(a.facility_id).active).length;
      if (!open) { heat += `<td class="na" data-tip="${DAYS[d]} ${hourText(h)}: ${tr("لا مرافق متاحة", "no facilities open")}"></td>`; continue; }
      const r = Math.min(used / open, 1);
      const bg = `color-mix(in oklab, var(--heat-hi) ${Math.round(6 + r * 94)}%, var(--heat-lo))`;
      heat += `<td style="background:${bg};color:${r > 0.5 ? "var(--heat-ink-hi)" : "var(--ink)"}"><button data-action="goto-day" data-day="${d}" data-tip="${DAYS[d]} ${hourText(h)}: ${tr(`${used} من ${open} محجوز`, `${used} of ${open} booked`)}"><span class="num">${used}/${open}</span></button></td>`;
    }
    heat += "</tr>";
  }
  heat += "</tbody>";

  const facRows = S.facilities.map((f) => {
    const n = sessionsOn(f), c = capacity(f);
    return `<div class="fac-row ${f.active ? "" : "off"}">
      ${court(f.type)}
      <div><div class="name">${nm(f.name)}</div>
        <div class="meter" style="--c:var(--${kind(f.type)})"><i style="width:${c ? Math.min(100, (n / c) * 100) : 0}%"></i></div></div>
      <div class="val num">${f.active ? `${n}/${c}` : `<span class="tag off">${tr("خارج الخدمة", "Out of service")}</span>`}</div>
    </div>`;
  }).join("");

  // ما يحتاج متابعة
  const alerts = [];
  if (st.pending) alerts.push(`<li><span class="ico off">${icon("requests")}</span><div class="body"><strong>${tr(`${count(st.pending, "request")} بانتظار الجدولة`, `${count(st.pending, "request")} awaiting scheduling`)}</strong><div class="reason">${tr("تُضاف إلى الجدول عند تشغيل الجدولة.", "They join the schedule when you generate it.")}</div></div></li>`);
  for (const a of S.assignments.filter((x) => invalidReason(x)).slice(0, 3)) {
    alerts.push(`<li><span class="ico off">${icon("alert")}</span><div class="body"><strong>${nm(X.team.get(a.team_id)?.name)}</strong>: ${nm(X.fac.get(a.facility_id).name)}${tr("، ", ", ")}${DAYS[a.day]} <span class="num">${hourText(a.hour)}</span><div class="reason">${invalidReason(a)}</div></div><button class="btn-ghost" data-action="open-booking" data-id="${a.request_id}">${tr("عرض", "View")}</button></li>`);
  }
  for (const u of S.unscheduled.slice(0, 5)) {
    const r = X.req.get(u.request_id);
    alerts.push(`<li><span class="ico no">${icon("close")}</span><div class="body"><strong>${nm(X.team.get(r.team_id)?.name)}</strong>: ${typeLabel(r.facility_type)}${tr("، ", ", ")}${prefText(r)}<div class="reason">${esc(reasonText(u.reason, u.reason_args))}</div></div><button class="btn-ghost" data-action="open-booking" data-id="${r.id}">${tr("جدولة يدوية", "Book manually")}</button></li>`);
  }
  if (S.unscheduled.length > 5) alerts.push(`<li><div class="body"><a href="#requests" data-action="req-filter" data-status="no">${tr(`عرض كل الطلبات غير الملبّاة (${S.unscheduled.length})`, `View all unmet requests (${S.unscheduled.length})`)}</a></div></li>`);
  for (const c of S.closures.slice(0, 4))
    alerts.push(`<li><span class="ico closed">${icon("cone")}</span><div class="body"><strong>${nm(X.fac.get(c.facility_id)?.name)}</strong> ${tr("مغلق", "closed")} ${DAYS[c.day]} ${span(c.from_hour, c.to_hour)}<div class="reason">${nm(c.reason)}</div></div></li>`);
  for (const f of S.facilities.filter((x) => !x.active))
    alerts.push(`<li><span class="ico off">${icon("power")}</span><div class="body"><strong>${nm(f.name)}</strong> ${tr("خارج الخدمة", "is out of service")}<div class="reason">${tr("لا تُجدوَل عليه أي جلسة حتى يعاد إلى الخدمة.", "No sessions are scheduled on it until it returns to service.")}</div></div></li>`);

  const run = S.lastRun;
  const runBox = run
    ? `<dl>
        <dt>${tr("التاريخ", "Date")}</dt><dd>${dateTime(run.created_at)}</dd>
        <dt>${tr("بواسطة", "By")}</dt><dd><span class="ltr">${esc(run.username)}</span></dd>
        <dt>${tr("المدة", "Duration")}</dt><dd><span class="num">${run.duration_ms.toFixed(1)} ms</span></dd>
        <dt>${tr("حجوزات نُقلت", "Bookings moved")}</dt><dd><span class="num">${run.moved}</span></dd>
        <dt>${tr("نسبة التلبية", "Fulfilment")}</dt><dd><b class="num">${pct(run.metrics.fulfilmentRate)}</b> <span class="muted small">${tr("مقابل", "vs")} <span class="num">${pct(run.baseline.fulfilmentRate)}</span> ${tr("بالتوزيع بالأسبقية", "first-come-first-served")}</span></dd>
      </dl><p style="margin:14px 0 0"><a href="#reports">${tr("تفاصيل الأداء في التقارير", "Performance details in Reports")}</a></p>`
    : `<p class="muted" style="margin:0">${tr("لم تُشغَّل الجدولة بعد. بعد تسجيل الطلبات اضغط «تشغيل الجدولة».", "The schedule hasn't been generated yet. Once requests are in, press “Generate schedule”.")}</p>`;

  return `${summary}
    <div class="dash">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>${tr("الإشغال خلال الأسبوع", "Occupancy this week")}</h2><span class="muted">${tr("الفترات المحجوزة من المتاحة في كل ساعة", "Booked of available slots per hour")}</span></div>
          <div class="panel-body"><div class="table-wrap"><table class="heat">${heat}</table></div>
            <div class="legend-ramp"><span>${tr("فارغ", "Empty")}</span><i></i><span>${tr("ممتلئ", "Full")}</span><span class="muted" style="margin-inline-start:auto">${tr("اضغط أي خانة لعرض جدول ذلك اليوم", "Select a cell to open that day's schedule")}</span></div></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>${tr("يحتاج متابعة", "Needs attention")}</h2></div>
          <div class="panel-body">${alerts.length ? `<ul class="alerts">${alerts.join("")}</ul>` : `<p class="muted" style="margin:0">${tr("كل الطلبات ملبّاة وكل المرافق في الخدمة.", "Every request is met and every facility is in service.")}</p>`}</div>
        </section>
      </div>
      <div class="stack">
        <section class="panel"><div class="panel-head"><h2>${tr("المرافق", "Facilities")}</h2><span class="muted">${tr("جلسات الأسبوع", "Sessions this week")}</span></div><div class="panel-body">${facRows}</div></section>
        <section class="panel runbox"><div class="panel-head"><h2>${tr("آخر جدولة", "Last run")}</h2></div><div class="panel-body">${runBox}</div></section>
      </div>
    </div>`;
}

// ---------- الجدول ----------
function bookingBlock(a, f) {
  const team = X.team.get(a.team_id);
  const r = X.req.get(a.request_id);
  const bad = invalidReason(a);
  let meta;
  if (bad) meta = `${icon("alert")}${bad}`;
  else if (a.fixed) meta = `${icon("lock", "lock")}${tr("مثبّت", "Fixed")}`;
  else if (a.matched_preference) meta = `${icon("star", "star")}${tr("في الموعد المطلوب", "Requested time")}`;
  else meta = r?.pref_day === null ? tr("بلا تفضيل", "No preference") : `${tr("طلب", "Asked")} ${DAYS[r.pref_day]} <span class="num">${hourText(r.pref_hour)}</span>`;
  const current = ui.drawer?.kind === "booking" && ui.drawer.id === a.request_id;
  return `<button class="bk" style="--c:${bad ? "var(--red)" : `var(--${kind(f.type)})`}" data-action="open-booking" data-id="${a.request_id}" aria-current="${current}" title="${esc(team?.name)}">
    <span class="t">${nm(team?.name)}</span><span class="m">${meta}</span></button>`;
}

function slotCell(f, d, h) {
  const a = X.at.get(`${f.id}|${d}|${h}`);
  if (a) return bookingBlock(a, f);
  if (!f.active || h < f.open_hour || h >= f.close_hour) return `<div class="cell-off"></div>`;
  const c = closureAt(f.id, d, h);
  if (c) return `<div class="cell-closed">${h === c.from_hour ? `${icon("cone")}${nm(c.reason)}` : ""}</div>`;
  const n = candidatesFor(f, d, h).length;
  return n ? `<button class="free" data-action="open-slot" data-f="${f.id}" data-d="${d}" data-h="${h}" aria-label="${esc(tr(`حجز يدوي في ${iso(f.name)} ${DAYS[d]} ${hourText(h)}`, `Book ${iso(f.name)} manually, ${DAYS[d]} ${hourText(h)}`))}">${icon("plus", "i-sm")}${tr("حجز يدوي", "Book")}</button>` : "";
}

const printHead = (title) => `<div class="print-head"><h2>${esc(title)}</h2><span>${esc(S.settings.orgName)}</span></div>`;
const gridLegend = () => `<div class="grid-legend">
  <span>${icon("star", "star")}${tr("في الموعد الذي طلبه الفريق", "At the team's requested time")}</span><span>${icon("lock")}${tr("موعد مثبّت", "Fixed time")}</span>
  <span><i class="sw hatch"></i>${tr("مغلق", "Closed")}</span><span><i class="sw off"></i>${tr("خارج ساعات العمل", "Outside opening hours")}</span></div>`;

function schedule() {
  if (!S.facilities.length) return noFacilities();
  const s = ui.sched;
  const modes = [["day", tr("يومي", "Day")], ["week", tr("أسبوعي لكل مرفق", "Week by facility")], ["team", tr("حسب الفريق", "By team")]]
    .map(([m, l]) => `<button data-action="sched-mode" data-mode="${m}" aria-pressed="${s.mode === m}">${l}</button>`).join("");
  const tools = `<div class="toolbar"><div class="seg" role="group" aria-label="${tr("طريقة العرض", "View")}">${modes}</div><span class="grow"></span>
    <button class="btn-quiet" data-action="csv" title="${tr("ملف CSV يفتح في Excel", "A CSV file that opens in Excel")}">${icon("download")}${tr("تصدير إلى Excel", "Export to Excel")}</button>
    <button class="btn-quiet" data-action="print">${icon("print")}${tr("طباعة", "Print")}</button></div>`;
  return tools + (s.mode === "day" ? scheduleDay() : s.mode === "week" ? scheduleWeek() : scheduleTeam());
}

function scheduleDay() {
  const d = ui.sched.day;
  const facs = [...S.facilities].sort((a, b) => b.active - a.active);
  const lo = Math.min(...facs.map((f) => f.open_hour)), hi = Math.max(...facs.map((f) => f.close_hour));
  const nowHour = new Date().getHours();
  const tabs = DAYS.map((name, i) => {
    const n = S.assignments.filter((a) => a.day === i).length;
    return `<button data-action="sched-day" data-day="${i}" aria-pressed="${i === d}"><strong>${name}${i === todayIndex() ? `<i class="today" title="${tr("اليوم", "Today")}"></i>` : ""}</strong><span>${count(n, "session")}</span></button>`;
  }).join("");
  const head = facs.map((f) => {
    const n = S.assignments.filter((a) => a.facility_id === f.id && a.day === d).length;
    const open = f.active ? Array.from({ length: f.close_hour - f.open_hour }, (_, k) => f.open_hour + k).filter((h) => isOpen(f, d, h)).length : 0;
    return `<th scope="col"><div class="col-head">${court(f.type)}<div><strong>${nm(f.name)}</strong><small>${f.active ? tr(`${n} من ${open} محجوز`, `${n} of ${open} booked`) : tr("خارج الخدمة", "Out of service")}</small></div></div></th>`;
  }).join("");
  let rows = "";
  for (let h = lo; h < hi; h++) {
    const now = d === todayIndex() && h === nowHour;
    rows += `<tr><th scope="row" class="time ${now ? "now" : ""}"${now ? ` title="${tr("الساعة الحالية", "Current hour")}"` : ""}><span class="num">${hourText(h)}</span></th>${facs.map((f) => `<td>${slotCell(f, d, h)}</td>`).join("")}</tr>`;
  }
  return `<div class="days" role="group" aria-label="${tr("اليوم", "Day")}" style="margin-bottom:14px">${tabs}</div>
    ${printHead(tr(`جدول يوم ${DAYS[d]}`, `${DAYS[d]} schedule`))}
    <div class="board"><table class="grid"><thead><tr><th class="time"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>${gridLegend()}`;
}

function scheduleWeek() {
  if (!X.fac.has(ui.sched.facility)) ui.sched.facility = S.facilities[0].id;
  const f = X.fac.get(ui.sched.facility);
  const chips = S.facilities.map((x) => `<button class="chip" data-action="sched-fac" data-id="${x.id}" aria-pressed="${x.id === f.id}">${court(x.type)}${nm(x.name)}</button>`).join("");
  const head = DAYS.map((name, i) => `<th scope="col"><div class="col-head"><div><strong>${name}</strong><small>${count(S.assignments.filter((a) => a.facility_id === f.id && a.day === i).length, "session")}</small></div></div></th>`).join("");
  let rows = "";
  for (let h = f.open_hour; h < f.close_hour; h++)
    rows += `<tr><th scope="row" class="time"><span class="num">${hourText(h)}</span></th>${DAYS.map((_, d) => `<td>${slotCell(f, d, h)}</td>`).join("")}</tr>`;
  return `<div class="chips" style="margin-bottom:14px">${chips}</div>
    ${printHead(tr(`${iso(f.name)}: الجدول الأسبوعي`, `${iso(f.name)}: weekly schedule`))}
    ${f.active ? "" : `<div class="banner" style="margin:0 0 14px">${icon("power")}<span>${tr("هذا المرفق خارج الخدمة؛ لا تُجدوَل عليه جلسات.", "This facility is out of service; no sessions are scheduled on it.")}</span></div>`}
    <div class="board"><table class="grid week"><thead><tr><th class="time"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>${gridLegend()}`;
}

function scheduleTeam() {
  if (!S.teams.length) return emptyState("football", tr("لا توجد فرق مسجّلة", "No teams yet"), tr("سجّل الفرق أولاً.", "Register teams first."), `<a class="btn" href="#teams">${PAGES.teams}</a>`);
  if (!X.team.has(ui.sched.team)) ui.sched.team = S.teams[0].id;
  const t = X.team.get(ui.sched.team);
  const options = S.teams.map((x) => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${nm(x.name)}</option>`).join("");
  const mine = S.assignments.filter((a) => a.team_id === t.id).sort((a, b) => a.day - b.day || a.hour - b.hour);
  const waiting = S.requests.filter((r) => r.team_id === t.id && !X.asg.has(r.id));
  const asked = S.requests.filter((r) => r.team_id === t.id).length;
  const items = mine.map((a) => {
    const f = X.fac.get(a.facility_id);
    return `<li><span class="d">${DAYS[a.day]}</span><span class="h num">${hourText(a.hour)}–${hourText(a.hour + 1)}</span>
      <span class="f">${court(f.type)}<span>${nm(f.name)}<span class="muted small" style="display:block">${typeLabel(f.type)}</span></span></span>
      <span class="no-print">${a.fixed ? statusTag({ kind: "fixed", label: tr("مثبّت", "Fixed") }) : a.matched_preference ? `<span class="tag ok">${icon("star")}${tr("الموعد المطلوب", "Requested time")}</span>` : ""}
      <button class="btn-ghost" data-action="open-booking" data-id="${a.request_id}">${tr("التفاصيل", "Details")}</button></span></li>`;
  }).join("");
  const unmet = waiting.map((r) => `<li><span class="d">${r.pref_day === null ? "–" : DAYS[r.pref_day]}</span><span class="h num">${r.pref_day === null ? "" : hourText(r.pref_hour)}</span>
      <span class="f">${typeLabel(r.facility_type)}</span><span class="no-print">${statusTag(statusOf(r))}<button class="btn-ghost" data-action="open-booking" data-id="${r.id}">${tr("جدولة يدوية", "Book manually")}</button></span></li>`).join("");
  const contact = [t.coach ? `${tr("المسؤول", "Coach")}: ${nm(t.coach)}` : "", t.phone ? `<span class="num">${esc(phoneText(t.phone))}</span>` : ""].filter(Boolean).join(tr("، ", ", "));
  return `<div class="toolbar no-print"><label class="field" style="flex-direction:row;align-items:center;gap:10px">${tr("الفريق", "Team")}
      <select data-change="sched-team" style="min-width:240px">${options}</select></label><span class="muted small">${contact}</span></div>
    ${printHead(tr(`جدول تدريبات فريق ${iso(t.name)}`, `Training schedule: ${iso(t.name)}`))}
    <section class="panel">
      <div class="panel-head"><h2>${nm(t.name)}</h2><span class="muted">${tr(`${count(mine.length, "session")} مؤكدة من ${asked}`, `${mine.length} of ${asked} sessions confirmed`)}</span></div>
      <div class="panel-body" style="padding:8px 0 4px">${mine.length ? `<ul class="fixture">${items}</ul>` : `<p class="muted" style="padding:0 20px">${tr("لا توجد جلسات مؤكدة لهذا الفريق.", "This team has no confirmed sessions.")}</p>`}</div>
    </section>
    ${waiting.length ? `<section class="panel no-print" style="margin-top:20px"><div class="panel-head"><h2>${tr("طلبات لم تُجدوَل", "Unscheduled requests")}</h2></div><div class="panel-body" style="padding:8px 0 4px"><ul class="fixture">${unmet}</ul></div></section>` : ""}`;
}

function exportCsv() {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [...S.assignments].sort((a, b) => a.facility_id - b.facility_id || a.day - b.day || a.hour - b.hour).map((a) => {
    const t = X.team.get(a.team_id);
    return [X.fac.get(a.facility_id).name, DAYS[a.day], hourText(a.hour), hourText(a.hour + 1), t?.name, t?.coach, t?.phone, a.fixed ? tr("مثبّت", "Fixed") : tr("مؤكَّد", "Confirmed")];
  });
  const head = tr(["المرفق", "اليوم", "من", "إلى", "الفريق", "المسؤول", "الهاتف", "الحالة"], ["Facility", "Day", "From", "To", "Team", "Coach", "Phone", "Status"]);
  const blob = new Blob(["﻿" + [head, ...rows].map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: tr("جدول-المرافق.csv", "facility-schedule.csv") });
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------- طلبات الحجز ----------
function requests() {
  if (!S.teams.length) return emptyState("basketball", tr("لا توجد فرق مسجّلة", "No teams yet"), tr("طلب الحجز يكون باسم فريق؛ سجّل الفرق أولاً.", "Each booking request belongs to a team; register teams first."), `<a class="btn" href="#teams">${icon("plus")}${tr("تسجيل فريق", "Add team")}</a>`);
  const types = [...new Set(S.requests.map((r) => r.facility_type))];
  return `<div class="toolbar">
      <div class="search"><input type="search" id="req-q" placeholder="${tr("بحث باسم الفريق أو رقم الطلب", "Search by team or request number")}" value="${esc(ui.req.q)}" aria-label="${tr("بحث", "Search")}"><svg class="i" aria-hidden="true"><use href="icons.svg#i-search"/></svg></div>
      <div class="seg" id="req-status" role="group" aria-label="${tr("الحالة", "Status")}"></div>
      <select data-change="req-type" aria-label="${tr("نوع المرفق", "Facility type")}"><option value="all">${tr("كل الأنواع", "All types")}</option>${types.map((t) => `<option value="${t}" ${ui.req.type === t ? "selected" : ""}>${typeLabel(t)}</option>`).join("")}</select>
      <span class="grow"></span>
      <button class="btn" data-action="form" data-form="request">${icon("plus")}${tr("طلب حجز جديد", "New request")}</button>
    </div><div id="req-list"></div>`;
}

function renderRequestList() {
  const q = ui.req.q.trim();
  const base = S.requests.map((r) => ({ r, s: statusOf(r), t: X.team.get(r.team_id) }))
    .filter(({ r, t }) => (!q || t?.name.toLowerCase().includes(q.toLowerCase()) || String(r.id) === q) && (ui.req.type === "all" || r.facility_type === ui.req.type));
  const n = (k) => base.filter(({ s }) => s.kind === k).length;
  $("#req-status").innerHTML = [["all", tr("الكل", "All"), base.length], ["ok", tr("مؤكَّد", "Confirmed"), n("ok")], ["fixed", tr("مثبّت", "Fixed"), n("fixed")], ["no", tr("غير ملبّى", "Unmet"), n("no")], ["new", tr("جديد", "New"), n("new")]]
    .map(([k, l, c]) => `<button data-action="req-status" data-status="${k}" aria-pressed="${ui.req.status === k}">${l}<span class="n num">${c}</span></button>`).join("");
  const shown = base.filter(({ s }) => ui.req.status === "all" || s.kind === ui.req.status);
  const rows = shown.map(({ r, s, t }) => {
    const where = s.a ? `${nm(X.fac.get(s.a.facility_id).name)}<div class="reason">${DAYS[s.a.day]} <span class="num">${hourText(s.a.hour)}</span></div>` : "–";
    return `<tr class="clickable" data-action="open-booking" data-id="${r.id}">
      <td class="num">${r.id}</td>
      <td><div class="team-cell"><span class="team-dot" style="--c:${teamColor(r.team_id)}">${initial(t?.name)}</span>${nm(t?.name)}</div></td>
      <td><span class="tag" style="--c:var(--${kind(r.facility_type)})"><i class="sw"></i>${typeLabel(r.facility_type)}</span></td>
      <td class="nowrap">${prefText(r)}</td>
      <td>${where}</td>
      <td>${statusTag(s)}${s.u ? `<div class="reason">${esc(reasonText(s.u.reason, s.u.reason_args))}</div>` : ""}</td>
    </tr>`;
  }).join("");
  $("#req-list").innerHTML = shown.length
    ? `<div class="panel table-wrap"><table class="list"><thead><tr><th>${tr("رقم", "No.")}</th><th>${tr("الفريق", "Team")}</th><th>${tr("النوع", "Type")}</th><th>${tr("الموعد المطلوب", "Requested time")}</th><th>${tr("الموعد المخصّص", "Assigned slot")}</th><th>${tr("الحالة", "Status")}</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : S.requests.length ? `<div class="panel empty"><p>${tr("لا توجد طلبات مطابقة للبحث.", "No requests match your search.")}</p></div>`
      : emptyState("volleyball", tr("لا توجد طلبات حجز", "No booking requests"), tr("سجّل طلبات الفرق بأوقاتها المفضّلة، ثم شغّل الجدولة.", "Add the teams' requests with their preferred times, then generate the schedule."), `<button class="btn" data-action="form" data-form="request">${icon("plus")}${tr("طلب حجز جديد", "New request")}</button>`);
}

// ---------- الفرق ----------
function teams() {
  const head = `<div class="toolbar"><span class="muted">${tr("عدد الفرق", "Teams")}: <span class="num">${S.teams.length}</span></span><span class="grow"></span>
    <button class="btn" data-action="form" data-form="team">${icon("plus")}${tr("تسجيل فريق", "Add team")}</button></div>`;
  if (!S.teams.length) return head + emptyState("football", tr("لا توجد فرق مسجّلة", "No teams yet"), tr("سجّل الفرق التي تحجز المرافق وبيانات الاتصال بمسؤوليها.", "Register the teams that book facilities and their contact details."));
  const rows = S.teams.map((t) => {
    const asked = S.requests.filter((r) => r.team_id === t.id).length;
    const got = S.assignments.filter((a) => a.team_id === t.id).length;
    const ratio = asked ? got / asked : 0;
    return `<tr>
      <td><div class="team-cell"><span class="team-dot" style="--c:${teamColor(t.id)}">${initial(t.name)}</span>${nm(t.name)}</div></td>
      <td>${t.coach ? esc(t.coach) : '<span class="muted">–</span>'}</td>
      <td>${t.phone ? `<a class="phone num" href="tel:${esc(t.phone)}">${esc(phoneText(t.phone))}</a>` : '<span class="muted">–</span>'}</td>
      <td class="num">${got} / ${asked}</td>
      <td>${asked ? `<div class="ratio"><div class="meter" style="--c:${ratio === 1 ? "var(--primary)" : ratio >= 0.8 ? "var(--accent-deep)" : "var(--red)"}"><i style="width:${ratio * 100}%"></i></div><span class="num">${Math.round(ratio * 100)}%</span></div>` : `<span class="muted small">${tr("لا طلبات", "No requests")}</span>`}</td>
      <td class="actions">
        <button class="btn-ghost" data-action="team-schedule" data-id="${t.id}">${icon("schedule", "i-sm")}${tr("الجدول", "Schedule")}</button>
        <button class="btn-ghost" data-action="form" data-form="team" data-id="${t.id}" aria-label="${esc(tr(`تعديل ${iso(t.name)}`, `Edit ${iso(t.name)}`))}">${icon("edit", "i-sm")}</button>
        <button class="btn-ghost danger" data-action="delete-team" data-id="${t.id}" aria-label="${esc(tr(`حذف ${iso(t.name)}`, `Delete ${iso(t.name)}`))}">${icon("trash", "i-sm")}</button></td>
    </tr>`;
  }).join("");
  return head + `<div class="panel table-wrap"><table class="list"><thead><tr><th>${tr("الفريق", "Team")}</th><th>${tr("المسؤول", "Coach")}</th><th>${tr("الهاتف", "Phone")}</th><th>${tr("مؤكَّد / مطلوب", "Confirmed / requested")}</th><th>${tr("نسبة التلبية", "Fulfilment")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- المرافق ----------
function facilities() {
  const active = S.facilities.filter((f) => f.active).length;
  const head = `<div class="toolbar"><span class="muted">${tr("عدد المرافق", "Facilities")}: <span class="num">${S.facilities.length}</span>${tr("، في الخدمة", ", in service")}: <span class="num">${active}</span></span><span class="grow"></span>
    <button class="btn-quiet" data-action="form" data-form="closure" ${S.facilities.length ? "" : "disabled"}>${icon("cone")}${tr("إغلاق فترة", "Close a period")}</button>
    <button class="btn" data-action="form" data-form="facility">${icon("plus")}${tr("تسجيل مرفق", "Add facility")}</button></div>`;
  if (!S.facilities.length) return head + noFacilities();
  const cards = S.facilities.map((f) => {
    const n = sessionsOn(f), c = capacity(f);
    const closures = S.closures.filter((x) => x.facility_id === f.id).length;
    return `<article class="panel fac-card ${f.active ? "" : "off"}">
      <div class="art"><img src="art/${artFor(f)}.svg" alt="" loading="lazy"><span class="tag ${f.active ? "ok" : "off"}">${f.active ? tr("في الخدمة", "In service") : tr("خارج الخدمة", "Out of service")}</span></div>
      <div class="info"><h3>${nm(f.name)}</h3>
        <div class="facts"><span>${typeLabel(f.type)}</span><span>${icon("clock")}${span(f.open_hour, f.close_hour)}</span>${closures ? `<span>${icon("cone")}${count(closures, "closure")}</span>` : ""}</div></div>
      <div class="occ">${tr("إشغال الأسبوع", "Weekly occupancy")} <b class="num">${n}/${c}</b><div class="meter" style="--c:var(--${kind(f.type)})"><i style="width:${c ? Math.min(100, (n / c) * 100) : 0}%"></i></div></div>
      <div class="foot">
        <button class="btn-ghost" data-action="form" data-form="facility" data-id="${f.id}">${icon("edit", "i-sm")}${tr("تعديل", "Edit")}</button>
        <button class="btn-ghost" data-action="toggle-facility" data-id="${f.id}" data-active="${!f.active}">${icon("power", "i-sm")}${f.active ? tr("إخراج من الخدمة", "Take out of service") : tr("إعادة إلى الخدمة", "Return to service")}</button>
        <span style="flex:1"></span>
        <button class="btn-ghost danger" data-action="delete-facility" data-id="${f.id}" aria-label="${esc(tr(`حذف ${iso(f.name)}`, `Delete ${iso(f.name)}`))}">${icon("trash", "i-sm")}</button>
      </div></article>`;
  }).join("");
  const closureRows = S.closures.map((c) => `<tr><td>${nm(X.fac.get(c.facility_id)?.name)}</td><td>${DAYS[c.day]}</td><td>${span(c.from_hour, c.to_hour)}</td><td>${nm(c.reason)}</td>
    <td class="actions"><button class="btn-ghost danger" data-action="delete-closure" data-id="${c.id}">${tr("إلغاء الإغلاق", "Remove closure")}</button></td></tr>`).join("");
  return head + `<div class="fac-grid">${cards}</div>
    <section class="panel" style="margin-top:22px">
      <div class="panel-head"><h2>${tr("فترات الإغلاق", "Closures")}</h2><span class="muted">${tr("ساعات لا يُحجز فيها المرفق خلال الأسبوع", "Hours when a facility can't be booked")}</span></div>
      <div class="panel-body" style="padding:12px 0 0">${S.closures.length
        ? `<div class="table-wrap"><table class="list"><thead><tr><th>${tr("المرفق", "Facility")}</th><th>${tr("اليوم", "Day")}</th><th>${tr("الساعات", "Hours")}</th><th>${tr("السبب", "Reason")}</th><th></th></tr></thead><tbody>${closureRows}</tbody></table></div>`
        : `<p class="muted" style="margin:0;padding:0 20px 18px">${tr("لا توجد فترات إغلاق. استخدم «إغلاق فترة» للصيانة أو المباريات الرسمية أو الفعاليات.", "No closures. Use “Close a period” for maintenance, official matches or events.")}</p>`}</div>
    </section>`;
}

// ---------- التقارير ----------
function reports() {
  const run = S.lastRun;
  if (!run) return emptyState("basketball", tr("لا توجد تقارير بعد", "No reports yet"), tr("تظهر مؤشرات الأداء بعد أول تشغيل للجدولة.", "Performance indicators appear after the first schedule run."));
  const m = run.metrics, b = run.baseline;
  const metric = (label, note, x, y, asPct = true) => `<div class="lbl">${label}<small>${note}</small></div>
    <div class="bars">
      <div class="bar"><div class="track"><div class="fill" style="--c:var(--primary);width:${x * 100}%"></div></div><span class="v">${asPct ? pct(x) : x.toFixed(3)}</span></div>
      <div class="bar"><div class="track"><div class="fill" style="--c:var(--baseline);width:${y * 100}%"></div></div><span class="v">${asPct ? pct(y) : y.toFixed(3)}</span></div>
    </div>`;
  const cmp = [
    metric(tr("تلبية الطلبات", "Requests met"), tr(`${m.scheduled} مقابل ${b.scheduled} من ${m.totalRequests}`, `${m.scheduled} vs ${b.scheduled} of ${m.totalRequests}`), m.fulfilmentRate, b.fulfilmentRate),
    metric(tr("إشغال المرافق", "Facility occupancy"), tr("الفترات المحجوزة من المتاحة", "Booked of available slots"), m.utilization, b.utilization),
    metric(tr("عدالة التوزيع (Jain)", "Fairness (Jain)"), tr("1 = تساوٍ تام بين الفرق", "1 = perfectly equal across teams"), m.fairnessIndex, b.fairnessIndex, false),
    metric(tr("أقل نسبة تلبية لفريق", "Lowest team fulfilment"), tr("حال الفريق الأقل حظاً", "The least-served team"), m.minTeamRatio, b.minTeamRatio),
    metric(tr("الحجز في الموعد المطلوب", "Booked at requested time"), tr("من الطلبات التي حددت موعداً", "Of requests with a preferred time"), m.preferenceRate, b.preferenceRate),
  ].join("");

  const types = [...new Set(S.requests.map((r) => r.facility_type))];
  const capRows = types.map((t) => {
    const cap = S.facilities.filter((f) => f.type === t).reduce((s, f) => s + capacity(f), 0);
    const asked = S.requests.filter((r) => r.facility_type === t).length;
    const ratio = cap ? asked / cap : 1;
    return `<div class="cap-row"><span>${typeLabel(t)}</span>
      <div class="cap-track" data-tip="${tr(`${asked} طلباً على ${cap} فترة متاحة`, `${asked} requests for ${cap} available slots`)}"><div class="fill" style="--c:var(--${kind(t)});width:${Math.min(ratio, 1) * 100}%"></div></div>
      <span class="small ${ratio > 1 ? "" : "muted"}"><b class="num">${pct(ratio)}</b> ${ratio > 1 ? `<span style="color:var(--red)">${tr("الطلب يفوق الطاقة", "demand exceeds capacity")}</span>` : tr("من الطاقة", "of capacity")}</span></div>`;
  }).join("");

  const teamRatios = S.teams.map((t) => {
    const asked = S.requests.filter((r) => r.team_id === t.id).length;
    return { t, asked, got: S.assignments.filter((a) => a.team_id === t.id).length };
  }).filter((x) => x.asked).sort((a, b) => a.got / a.asked - b.got / b.asked);
  const presentTypes = [...new Set(teamRatios.map((x) => X.teamType.get(x.t.id)))];
  const teamBars = teamRatios.map(({ t, asked, got }) => `<div class="cap-row" style="grid-template-columns:minmax(150px,210px) minmax(0,1fr) 54px;padding:5px 0;border:0">
      <span class="small">${nm(t.name)}</span>
      <div class="cap-track" style="height:10px" data-tip="${esc(t.name)}: ${got}/${asked}"><div class="fill" style="--c:${teamColor(t.id)};width:${(got / asked) * 100}%"></div></div>
      <span class="small num" style="text-align:end">${got}/${asked}</span></div>`).join("");

  const log = S.runs.map((r) => `<tr><td class="nowrap">${dateTime(r.created_at)}</td><td><span class="ltr">${esc(r.username)}</span></td>
    <td class="num">${r.metrics.scheduled}</td><td class="num">${r.metrics.totalRequests - r.metrics.scheduled}</td><td class="num">${r.moved}</td>
    <td class="num">${r.stats.searchSteps}</td><td class="num">${r.stats.backtracks}</td><td class="num">${r.duration_ms.toFixed(1)} ms</td></tr>`).join("");

  return `<div class="toolbar"><span class="muted">${tr("بيانات آخر جدولة", "Data from the last run")}: ${dateTime(run.created_at)}</span><span class="grow"></span><button class="btn-quiet" data-action="print">${icon("print")}${tr("طباعة التقرير", "Print report")}</button></div>
    ${printHead(tr("تقرير أداء الجدولة", "Scheduling performance report"))}
    <section class="panel">
      <div class="panel-head"><h2>${tr("الجدولة الآلية مقارنة بالتوزيع بالأسبقية", "Automatic scheduling vs first-come-first-served")}</h2>
        <div class="key"><span><i style="--c:var(--primary)"></i>${tr("نسق", "Nasaq")}</span><span><i style="--c:var(--baseline)"></i>${tr("التوزيع بالأسبقية", "First-come-first-served")}</span></div></div>
      <div class="panel-body"><div class="cmp">${cmp}</div>
        <p class="muted small" style="margin:18px 0 0">${tr(
          `التوزيع بالأسبقية: معالجة الطلبات نفسها بترتيب ورودها، كلٌّ في موعده المطلوب أو الساعة المجاورة إن توفّرت، وهو الأسلوب اليدوي المعتاد. التعارضات في الجدولين: <span class="num">${m.conflicts}</span> و<span class="num">${b.conflicts}</span>.`,
          `First-come-first-served: the same requests handled in arrival order, each at its requested time or the adjacent hour if free, the usual manual method. Conflicts in the two schedules: <span class="num">${m.conflicts}</span> and <span class="num">${b.conflicts}</span>.`)}</p></div>
    </section>
    <div class="two" style="margin-top:20px">
      <section class="panel"><div class="panel-head"><h2>${tr("الطلب مقارنة بالطاقة", "Demand vs capacity")}</h2><span class="muted">${tr("لكل نوع مرفق", "By facility type")}</span></div><div class="panel-body">${capRows}</div></section>
      <section class="panel"><div class="panel-head"><h2>${tr("تلبية كل فريق", "Fulfilment by team")}</h2>
        <div class="key">${presentTypes.map((t) => `<span><i style="--c:var(--${kind(t)})"></i>${typeLabel(t)}</span>`).join("")}</div></div>
        <div class="panel-body">${teamBars}</div></section>
    </div>
    <section class="panel" style="margin-top:20px"><div class="panel-head"><h2>${tr("سجل تشغيلات الجدولة", "Schedule runs")}</h2></div>
      <div class="panel-body table-wrap" style="padding:12px 0 0"><table class="list"><thead><tr><th>${tr("التاريخ", "Date")}</th><th>${tr("المستخدم", "User")}</th><th>${tr("مؤكَّد", "Confirmed")}</th><th>${tr("غير ملبّى", "Unmet")}</th><th>${tr("نُقل", "Moved")}</th><th>${tr("خطوات البحث", "Search steps")}</th><th>${tr("التراجعات", "Backtracks")}</th><th>${tr("المدة", "Duration")}</th></tr></thead><tbody>${log}</tbody></table></div></section>`;
}

// ---------- سجل النشاط ----------
function activity() {
  if (!S.activity.length) return emptyState("tennis", tr("لا يوجد نشاط مسجّل", "No activity yet"), tr("تُسجَّل هنا كل عملية إضافة أو تعديل أو جدولة مع اسم من قام بها ووقتها.", "Every addition, change and schedule run is recorded here with who did it and when."));
  const names = new Map(S.users.map((u) => [u.username, u.full_name]));
  let html = "", lastDay = "";
  for (const e of S.activity) {
    const day = fmt(e.at, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (day !== lastDay) { html += `${lastDay ? "</ul>" : ""}<div class="log-day">${day}</div><ul class="log">`; lastDay = day; }
    html += `<li><span class="tm">${fmt(e.at, { hour: "2-digit", minute: "2-digit", hour12: false })}</span><span class="who">${nm(names.get(e.username) ?? e.username)}</span><span>${esc(activityText(e.action, e.params))}</span></li>`;
  }
  return `<p class="muted" style="margin:0 0 14px">${tr(`آخر ${S.activity.length} عملية. السجل للقراءة فقط ولا يمكن تعديله من الواجهة.`, `The last ${S.activity.length} operations. The log is read-only and can't be edited from the interface.`)}</p>
    <section class="panel" style="overflow:hidden">${html}</ul></section>`;
}

// ---------- الإعدادات ----------
function settings() {
  const on = S.settings.publicBoard === "on";
  const boardUrl = `${location.origin}/board.html`;
  const users = S.users.map((u) => `<tr><td><div class="team-cell"><span class="avatar" style="width:30px;height:30px;font-size:13px">${esc(u.full_name.trim().charAt(0))}</span>${nm(u.full_name)}</div></td>
    <td><span class="ltr">${esc(u.username)}</span></td><td>${fmt(u.created_at, { day: "numeric", month: "long", year: "numeric" })}</td>
    <td class="actions">${u.id === S.user.id ? `<span class="muted small">${tr("حسابك", "Your account")}</span>` : `<button class="btn-ghost danger" data-action="delete-user" data-id="${u.id}">${tr("حذف", "Delete")}</button>`}</td></tr>`).join("");
  return `<div class="settings">
    <form class="panel" id="org-form"><div class="panel-head"><h2>${tr("المؤسسة", "Organisation")}</h2></div><div class="panel-body">
      <label class="field">${tr("اسم المؤسسة كما يظهر في الترويسة والطباعة", "Organisation name, as shown in headers and printouts")}<input name="orgName" value="${esc(S.settings.orgName)}" required></label>
      <div class="form-actions"><button class="btn">${tr("حفظ", "Save")}</button></div></div></form>

    <section class="panel"><div class="panel-head"><h2>${tr("لوحة العرض العامة", "Public board")}</h2></div><div class="panel-body">
      <p class="muted" style="margin:0 0 14px">${tr("شاشة لمدخل المركز تعرض جلسات اليوم في كل مرفق والجلسة الجارية الآن. لا تعرض بيانات الاتصال بالفرق، ولا تحتاج تسجيل دخول.", "A screen for the entrance showing today's sessions in every facility and the one in progress. It shows no contact details and needs no sign-in.")}</p>
      <label class="switch"><input type="checkbox" data-change="public-board" ${on ? "checked" : ""}><span class="track"></span>${on ? tr("مفعّلة", "On") : tr("متوقفة", "Off")}</label>
      ${on ? `<div class="board-link">${icon("screen")}<code>${esc(boardUrl)}</code><a class="btn-quiet" href="/board.html" target="_blank" rel="noopener">${icon("external", "i-sm")}${tr("فتح", "Open")}</a></div>` : ""}
    </div></section>

    <section class="panel wide"><div class="panel-head"><h2>${tr("المستخدمون", "Users")}</h2><button class="btn-quiet" data-action="form" data-form="user">${icon("plus")}${tr("إضافة مستخدم", "Add user")}</button></div>
      <div class="panel-body table-wrap" style="padding:12px 0 0"><table class="list"><thead><tr><th>${tr("الاسم", "Name")}</th><th>${tr("اسم الدخول", "Username")}</th><th>${tr("تاريخ الإضافة", "Added")}</th><th></th></tr></thead><tbody>${users}</tbody></table></div></section>

    <form class="panel" id="password-form"><div class="panel-head"><h2>${tr("تغيير كلمة المرور", "Change password")}</h2></div><div class="panel-body">
      <div class="form-grid">
        <label class="field full">${tr("كلمة المرور الحالية", "Current password")}<input name="current" type="password" autocomplete="current-password" required></label>
        <label class="field full">${tr("كلمة المرور الجديدة (8 أحرف على الأقل)", "New password (at least 8 characters)")}<input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      </div><div class="form-actions"><button class="btn">${tr("تغيير كلمة المرور", "Change password")}</button></div></div></form>

    <section class="panel"><div class="panel-head"><h2>${tr("البيانات", "Data")}</h2></div><div class="panel-body">
      <p class="muted" style="margin:0 0 14px">${tr("البيانات التجريبية أسبوع تدريب كامل: 4 مرافق و20 فريقاً و121 طلب حجز. تحميلها أو حذف البيانات يزيل المرافق والفرق والطلبات الحالية، ويبقى سجل النشاط والمستخدمون.", "The demo data is a full training week: 4 facilities, 20 teams and 121 booking requests. Loading it or deleting data removes current facilities, teams and requests; users and the activity log stay.")}</p>
      <div class="toolbar" style="margin:0"><button class="btn-quiet" data-action="load-demo">${tr("تحميل بيانات تجريبية", "Load demo data")}</button><button class="btn-danger" data-action="clear-data">${icon("trash", "i-sm")}${tr("حذف جميع البيانات", "Delete all data")}</button></div>
    </div></section>
  </div>`;
}

const VIEWS = { dashboard, schedule, requests, teams, facilities, reports, activity, settings };

// ======================= (4) اللوح الجانبي =======================
function openDrawer(d) {
  ui.drawer = d;
  renderDrawer();
  // إعادة رسم الصفحة لإبراز الحجز المحدد في الجدول
  if (currentPage() === "schedule") $("#page").innerHTML = VIEWS.schedule();
  $("#drawer").querySelector("button")?.focus();
}
function closeDrawer() {
  const had = ui.drawer;
  ui.drawer = null;
  renderDrawer();
  if (had && currentPage() === "schedule") $("#page").innerHTML = VIEWS.schedule();
}

function renderDrawer() {
  const el = $("#drawer");
  const d = ui.drawer;
  const html = d?.kind === "booking" ? bookingDrawer(d) : d?.kind === "slot" ? slotDrawer(d) : null;
  if (!html) {
    ui.drawer = null;
    document.body.classList.remove("drawer-open");
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    $("#scrim").hidden = !document.getElementById("app").classList.contains("nav-open");
    return;
  }
  el.innerHTML = html;
  document.body.classList.add("drawer-open");
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  $("#scrim").hidden = window.innerWidth > 1100;
}

function bookingDrawer(d) {
  const r = X.req.get(d.id);
  if (!r) return null;
  const t = X.team.get(r.team_id);
  const s = statusOf(r);
  const a = s.a, f = a && X.fac.get(a.facility_id);
  let body = "";
  if (a) {
    body += `<div class="slot-big" style="--c:var(--${kind(f.type)})"><span class="h num">${hourText(a.hour)}</span><div><div class="d">${DAYS[a.day]}</div><div class="f">${nm(f.name)}${tr("، حتى", ", until")} <span class="num">${hourText(a.hour + 1)}</span></div></div></div>
      <div class="chips" style="margin-top:12px">${statusTag(s)}${a.matched_preference ? `<span class="tag ok">${icon("star")}${tr("في الموعد المطلوب", "Requested time")}</span>` : ""}${invalidReason(a) ? `<span class="tag no">${icon("alert")}${invalidReason(a)}</span>` : ""}</div>`;
  } else if (s.u) {
    body += `<div class="explain no" style="margin-top:0"><b>${tr("غير ملبّى", "Unmet")}</b>${esc(reasonText(s.u.reason, s.u.reason_args))}</div>`;
  } else {
    body += `<div class="explain new" style="margin-top:0"><b>${tr("جديد", "New")}</b>${tr("لم يدخل الجدول بعد. شغّل الجدولة، أو احجزه يدوياً في موعد متاح.", "Not in the schedule yet. Generate the schedule, or book it manually in a free slot.")}</div>`;
  }
  body += `<dl class="kv"><dt>${tr("الموعد المطلوب", "Requested time")}</dt><dd>${prefText(r)}</dd>
    <dt>${tr("المسؤول", "Coach")}</dt><dd>${t?.coach ? esc(t.coach) : "–"}</dd>
    <dt>${tr("الهاتف", "Phone")}</dt><dd>${t?.phone ? `<a class="phone num" href="tel:${esc(t.phone)}">${esc(phoneText(t.phone))}</a>` : "–"}</dd>
    <dt>${tr("تاريخ الطلب", "Requested on")}</dt><dd>${dateTime(r.created_at)}</dd></dl>`;
  if (a) body += `<div class="explain"><b>${tr("سبب التخصيص", "Why this slot")}</b>${esc(reasonText(a.reason, a.reason_args))}</div>`;

  if (d.mode === "move") {
    body += `<h3 style="font-size:16px;margin:22px 0 0">${a ? tr("اختر الموعد الجديد", "Choose the new time") : tr("اختر موعداً للحجز", "Choose a time to book")}</h3>`;
    if (!d.options) body += `<p class="muted">${tr("جارٍ البحث عن المواعيد المتاحة…", "Finding available times…")}</p>`;
    else if (!d.options.length) body += `<p class="muted">${tr("لا توجد فترة متاحة لهذا النوع: كل الفترات محجوزة أو مغلقة، أو للفريق جلسة في الأوقات المتبقية.", "No slot is available for this type: everything is booked or closed, or the team has a session at the remaining times.")}</p>`;
    else {
      const multi = new Set(d.options.map((o) => o.facilityId)).size > 1;
      body += `<p class="muted small" style="margin:4px 0 0">${tr("المواعيد التي تحقق كل القيود فقط، مرتبة بالقرب من الموعد المطلوب. المؤطّر بالأصفر هو الموعد المطلوب نفسه.", "Only times that satisfy every constraint, nearest to the requested time first. The one outlined in yellow is the requested time itself.")}</p>`;
      // الأيام بترتيب قربها من الموعد المطلوب (الخادم يرتّب المواعيد بالقرب)
      for (const day of [...new Set(d.options.map((o) => o.day))]) {
        const opts = d.options.filter((o) => o.day === day);
        body += `<div class="opt-day"><h4>${DAYS[day]}</h4><div class="opt-list">${opts.sort((x, y) => x.hour - y.hour || x.facilityId - y.facilityId).map((o) =>
          `<button class="opt ${o.preferred ? "pref" : ""}" data-action="place" data-id="${r.id}" data-f="${o.facilityId}" data-d="${o.day}" data-h="${o.hour}"><b class="num">${hourText(o.hour)}</b>${multi ? `<span>${nm(X.fac.get(o.facilityId)?.name)}</span>` : ""}</button>`).join("")}</div></div>`;
      }
    }
  }

  let foot;
  if (d.mode === "move") foot = `<button class="btn-quiet" data-action="drawer-back">${tr("رجوع", "Back")}</button>`;
  else if (a) foot = `
    <button class="btn-quiet" data-action="fix" data-id="${r.id}" data-fixed="${!a.fixed}">${icon(a.fixed ? "unlock" : "lock", "i-sm")}${a.fixed ? tr("إلغاء التثبيت", "Unfix") : tr("تثبيت الموعد", "Fix this time")}</button>
    <button class="btn-quiet" data-action="drawer-move">${icon("move", "i-sm")}${tr("نقل", "Move")}</button>
    <span style="flex:1"></span><button class="btn-danger" data-action="cancel-request" data-id="${r.id}">${tr("إلغاء الطلب", "Cancel request")}</button>`;
  else foot = `<button class="btn" data-action="drawer-move">${icon("schedule", "i-sm")}${tr("جدولة يدوية", "Book manually")}</button><span style="flex:1"></span><button class="btn-danger" data-action="cancel-request" data-id="${r.id}">${tr("إلغاء الطلب", "Cancel request")}</button>`;

  return `<div class="drawer-head">${court(r.facility_type)}<div><h2>${nm(t?.name)}</h2><p>${typeLabel(r.facility_type)}${tr("، الطلب رقم", ", request no.")} <span class="num">${r.id}</span></p></div>
      <button class="icon-btn" data-action="drawer-close" aria-label="${tr("إغلاق", "Close")}">${icon("close")}</button></div>
    <div class="drawer-body">${body}</div><div class="drawer-foot">${foot}</div>`;
}

function slotDrawer(d) {
  const f = X.fac.get(d.facilityId);
  if (!f || X.at.has(`${f.id}|${d.day}|${d.hour}`) || !isOpen(f, d.day, d.hour)) return null;
  const list = candidatesFor(f, d.day, d.hour).sort((a, b) => (X.uns.has(b.id) - X.uns.has(a.id)) || a.id - b.id).map((r) => {
    const s = statusOf(r);
    return `<button class="cand" data-action="place" data-id="${r.id}" data-f="${f.id}" data-d="${d.day}" data-h="${d.hour}">
      <span class="team-dot" style="--c:${teamColor(r.team_id)}">${initial(X.team.get(r.team_id)?.name)}</span>
      <span class="body"><strong>${nm(X.team.get(r.team_id)?.name)}</strong>${tr(`الطلب ${r.id}، طلب`, `Request ${r.id}, asked for`)} ${prefText(r)}</span>${statusTag(s)}</button>`;
  }).join("");
  return `<div class="drawer-head">${court(f.type)}<div><h2>${nm(f.name)}</h2><p>${DAYS[d.day]} ${span(d.hour, d.hour + 1)}${tr("، فترة متاحة", ", free slot")}</p></div>
      <button class="icon-btn" data-action="drawer-close" aria-label="${tr("إغلاق", "Close")}">${icon("close")}</button></div>
    <div class="drawer-body"><h3 style="font-size:16px;margin:0 0 4px">${tr("طلبات يمكن حجزها هنا", "Requests that fit here")}</h3>
      <p class="muted small" style="margin:0 0 14px">${tr(`طلبات ${typeLabel(f.type)} غير المجدولة التي ليس لفريقها جلسة في هذا الوقت. الحجز اليدوي يُثبَّت تلقائياً.`, `Unscheduled ${typeLabel(f.type)} requests whose team is free at this time. A manual booking is fixed automatically.`)}</p>${list}</div>
    <div class="drawer-foot"><button class="btn-quiet" data-action="form" data-form="closure" data-f="${f.id}" data-d="${d.day}" data-h="${d.hour}">${icon("cone", "i-sm")}${tr("إغلاق هذه الفترة", "Close this slot")}</button></div>`;
}

// ======================= النوافذ الحوارية =======================
const sel = (name, options, selected) => `<select name="${name}">${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, hourText(from + i)]);
const typeChoices = () => {
  const present = [...new Set(S.facilities.map((f) => f.type))];
  return (present.length ? present : Object.keys(TYPES)).map((t) => [t, typeLabel(t)]);
};

const FORMS = {
  request: () => ({
    title: tr("طلب حجز جديد", "New booking request"),
    note: tr("كل جلسة طلبٌ مستقل. الموعد المطلوب تفضيل يراعيه المحرّك قدر الإمكان، وليس شرطاً.", "Each session is a separate request. The requested time is a preference the engine honours where possible, not a condition."),
    submit: tr("تسجيل الطلب", "Add request"), method: "POST", path: "/api/requests",
    done: (s, b) => Number(b.count) > 1 ? tr(`سُجّلت ${b.count} طلبات. شغّل الجدولة لإدراجها في الجدول.`, `${b.count} requests added. Generate the schedule to include them.`) : tr("سُجّل طلب الحجز. شغّل الجدولة لإدراجه في الجدول.", "Request added. Generate the schedule to include it."),
    fields: `<label class="field full">${tr("الفريق", "Team")}${sel("teamId", S.teams.map((t) => [t.id, esc(t.name)]), ui.sched.team)}</label>
      <label class="field">${tr("نوع المرفق", "Facility type")}${sel("facilityType", typeChoices())}</label>
      <label class="field">${tr("عدد الجلسات في الأسبوع", "Sessions per week")}<input type="number" name="count" min="1" max="14" value="1" required></label>
      <label class="field">${tr("اليوم المطلوب", "Requested day")}${sel("prefDay", [["", tr("بلا تفضيل", "No preference")], ...DAYS.map((d, i) => [i, d])], "")}</label>
      <label class="field">${tr("الساعة المطلوبة", "Requested hour")}${sel("prefHour", hours(6, 23), 18)}</label>`,
  }),
  team: (id) => {
    const t = id ? X.team.get(id) : {};
    return {
      title: id ? tr(`تعديل بيانات ${iso(t.name)}`, `Edit ${iso(t.name)}`) : tr("تسجيل فريق", "Add team"), submit: id ? tr("حفظ التعديلات", "Save changes") : tr("تسجيل الفريق", "Add team"),
      method: id ? "PUT" : "POST", path: id ? `/api/teams/${id}` : "/api/teams", done: id ? tr("حُفظت بيانات الفريق", "Team saved") : tr("سُجّل الفريق", "Team added"),
      fields: `<label class="field full">${tr("اسم الفريق", "Team name")}<input name="name" value="${esc(t.name)}" required></label>
        <label class="field">${tr("اسم المسؤول (المدرب)", "Contact (coach)")}<input name="coach" value="${esc(t.coach)}"></label>
        <label class="field">${tr("رقم الهاتف", "Phone")}<input name="phone" type="tel" dir="ltr" value="${esc(t.phone)}" placeholder="09XXXXXXXX"></label>`,
    };
  },
  facility: (id) => {
    const f = id ? X.fac.get(id) : { open_hour: 16, close_hour: 22 };
    return {
      title: id ? tr(`تعديل ${iso(f.name)}`, `Edit ${iso(f.name)}`) : tr("تسجيل مرفق", "Add facility"),
      note: id ? tr("تقليص الساعات أو تغيير النوع قد يُبطل حجوزات قائمة؛ تُنقل عند تشغيل الجدولة.", "Shortening hours or changing the type can invalidate existing bookings; they move when you generate the schedule.") : "",
      submit: id ? tr("حفظ التعديلات", "Save changes") : tr("تسجيل المرفق", "Add facility"), method: id ? "PUT" : "POST", path: id ? `/api/facilities/${id}` : "/api/facilities",
      done: id ? tr("حُفظت بيانات المرفق", "Facility saved") : tr("سُجّل المرفق", "Facility added"),
      fields: `<label class="field full">${tr("اسم المرفق", "Facility name")}<input name="name" value="${esc(f.name)}" required placeholder="${tr("مثال: الملعب الرئيسي", "e.g. Main pitch")}"></label>
        <label class="field full">${tr("النوع", "Type")}${sel("type", Object.entries(TYPES), f.type)}</label>
        <label class="field">${tr("يفتح الساعة", "Opens at")}${sel("openHour", hours(0, 23), f.open_hour)}</label>
        <label class="field">${tr("يغلق الساعة", "Closes at")}${sel("closeHour", hours(1, 24), f.close_hour)}</label>`,
    };
  },
  closure: (_id, ds) => {
    const fid = ds.f ? Number(ds.f) : S.facilities[0]?.id;
    const h = ds.h ? Number(ds.h) : 18;
    return {
      title: tr("إغلاق فترة", "Close a period"),
      note: tr("لا يُحجز المرفق في هذه الساعات. الحجوزات القائمة فيها تُنقل إلى أقرب موعد عند تشغيل الجدولة.", "The facility can't be booked during these hours. Existing bookings in them move to the nearest time when you generate the schedule."),
      submit: tr("إغلاق الفترة", "Close period"), method: "POST", path: "/api/closures",
      done: tr("سُجّلت فترة الإغلاق. شغّل الجدولة لنقل الحجوزات المتأثرة.", "Closure saved. Generate the schedule to move the affected bookings."),
      fields: `<label class="field full">${tr("المرفق", "Facility")}${sel("facilityId", S.facilities.map((f) => [f.id, esc(f.name)]), fid)}</label>
        <label class="field full">${tr("اليوم", "Day")}${sel("day", DAYS.map((d, i) => [i, d]), ds.d ?? ui.sched.day)}</label>
        <label class="field">${tr("من", "From")}${sel("fromHour", hours(0, 23), h)}</label>
        <label class="field">${tr("إلى", "To")}${sel("toHour", hours(1, 24), h + (ds.h ? 1 : 2))}</label>
        <label class="field full">${tr("السبب", "Reason")}<input name="reason" list="closure-reasons" required placeholder="${tr("مثال: صيانة الإضاءة", "e.g. Floodlight maintenance")}">
          <datalist id="closure-reasons">${CLOSURE_REASONS.map((r) => `<option value="${r}">`).join("")}</datalist></label>`,
    };
  },
  user: () => ({
    title: tr("إضافة مستخدم", "Add user"), note: tr("للمستخدم صلاحية الإدارة كاملة، وتُسجَّل عملياته في سجل النشاط باسمه.", "Users have full admin rights, and their operations are recorded in the activity log under their name."),
    submit: tr("إضافة المستخدم", "Add user"), method: "POST", path: "/api/users", done: tr("أُضيف المستخدم", "User added"),
    fields: `<label class="field full">${tr("الاسم الكامل", "Full name")}<input name="fullName" required></label>
      <label class="field">${tr("اسم الدخول", "Username")}<input name="username" dir="ltr" required pattern="[a-zA-Z0-9._\\-]{3,30}" placeholder="ahmed.osman"></label>
      <label class="field">${tr("كلمة المرور", "Password")}<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>`,
  }),
};

function openForm(kindName, id, ds = {}) {
  const f = FORMS[kindName](id, ds);
  const dlg = $("#dialog");
  dlg.innerHTML = `<div class="d-head"><h2>${esc(f.title)}</h2>${f.note ? `<p>${f.note}</p>` : ""}</div>
    <form method="dialog" data-form="${kindName}" data-id="${id ?? ""}">
      <div class="form-grid">${f.fields}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions"><button class="btn" value="ok">${f.submit}</button><button type="button" class="btn-quiet" data-action="dialog-close">${tr("إلغاء", "Cancel")}</button></div>
    </form>`;
  dlg.showModal();
  dlg.querySelector("input:not([type=hidden]), select")?.focus();
}

/** نافذة تأكيد بديلة عن confirm() */
function ask(title, text, okLabel, danger = true) {
  const dlg = $("#confirm");
  dlg.innerHTML = `<div class="d-head"><h2>${esc(title)}</h2><p>${text}</p></div>
    <div class="d-body form-actions" style="margin:0"><button class="${danger ? "btn-danger" : "btn"}" data-answer="yes">${esc(okLabel)}</button><button class="btn-quiet" data-answer="no">${tr("تراجع", "Go back")}</button></div>`;
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.onclick = (e) => {
      const b = e.target.closest("[data-answer]");
      if (!b) return;
      dlg.close();
      resolve(b.dataset.answer === "yes");
    };
    dlg.oncancel = () => resolve(false);
  });
}

// ======================= (5) الأحداث =======================
const ACTIONS = {
  menu: () => { document.getElementById("app").classList.toggle("nav-open"); $("#scrim").hidden = !document.getElementById("app").classList.contains("nav-open"); },
  "close-overlays": () => { document.getElementById("app").classList.remove("nav-open"); closeDrawer(); $("#scrim").hidden = true; },
  theme: () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* التفضيل يبقى لهذه الجلسة فقط */ }
  },
  lang: () => setLang(LANG === "en" ? "ar" : "en"),
  logout: async () => { await fetch("/api/logout", { method: "POST" }); location.replace("/login.html"); },

  run: async (b) => {
    const hadSchedule = S.assignments.length > 0;
    const label = b.querySelector("span");
    b.disabled = true;
    label.textContent = tr("جارٍ الجدولة…", "Generating…");
    await act("POST", "/api/schedule/run", null, (s) => {
      const m = s.lastRun.metrics, unmet = m.totalRequests - m.scheduled, ms = s.lastRun.duration_ms.toFixed(0);
      return hadSchedule
        ? tr(`اكتملت إعادة الجدولة: مؤكَّد ${m.scheduled} من ${m.totalRequests}، غير ملبّى ${unmet}، نُقل ${s.lastRun.moved}، في ${ms} ms`, `Schedule regenerated: ${m.scheduled} of ${m.totalRequests} confirmed, ${unmet} unmet, ${s.lastRun.moved} moved, in ${ms} ms`)
        : tr(`اكتملت الجدولة: مؤكَّد ${m.scheduled} من ${m.totalRequests}، غير ملبّى ${unmet}، في ${ms} ms`, `Schedule generated: ${m.scheduled} of ${m.totalRequests} confirmed, ${unmet} unmet, in ${ms} ms`);
    });
    b.disabled = false;
    label.textContent = tr("تشغيل الجدولة", "Generate schedule");
  },

  "goto-day": (b) => { ui.sched.mode = "day"; ui.sched.day = Number(b.dataset.day); location.hash = "#schedule"; },
  "sched-mode": (b) => { ui.sched.mode = b.dataset.mode; render(); },
  "sched-day": (b) => { ui.sched.day = Number(b.dataset.day); render(); },
  "sched-fac": (b) => { ui.sched.facility = Number(b.dataset.id); render(); },
  "team-schedule": (b) => { ui.sched.mode = "team"; ui.sched.team = Number(b.dataset.id); location.hash = "#schedule"; },
  "req-status": (b) => { ui.req.status = b.dataset.status; renderRequestList(); },
  "req-filter": (b) => { ui.req.status = b.dataset.status; if (currentPage() === "requests") render(); },

  "open-booking": (b) => openDrawer({ kind: "booking", id: Number(b.dataset.id), mode: "view" }),
  "open-slot": (b) => openDrawer({ kind: "slot", facilityId: Number(b.dataset.f), day: Number(b.dataset.d), hour: Number(b.dataset.h) }),
  "drawer-close": () => closeDrawer(),
  "drawer-back": () => { ui.drawer.mode = "view"; renderDrawer(); },
  "drawer-move": async () => {
    const d = ui.drawer;
    d.mode = "move"; d.options = null;
    renderDrawer();
    try { d.options = await api("GET", `/api/requests/${d.id}/options`); } catch (err) { toast(err.message, true); d.options = []; }
    if (ui.drawer === d) renderDrawer();
  },
  place: async (b) => {
    const team = X.team.get(X.req.get(Number(b.dataset.id))?.team_id)?.name;
    const when = `${DAYS[b.dataset.d]} ${hourText(Number(b.dataset.h))}`;
    const ok = await act("POST", `/api/requests/${b.dataset.id}/place`, { facilityId: b.dataset.f, day: b.dataset.d, hour: b.dataset.h },
      tr(`حُجز للفريق ${iso(team)}: ${when}، وثُبّت الموعد`, `Booked ${iso(team)}: ${when}, and fixed the time`));
    if (ok) { ui.drawer = { kind: "booking", id: Number(b.dataset.id), mode: "view" }; renderDrawer(); if (currentPage() === "schedule") $("#page").innerHTML = VIEWS.schedule(); }
  },
  fix: (b) => act("PUT", `/api/requests/${b.dataset.id}/fixed`, { fixed: b.dataset.fixed === "true" },
    b.dataset.fixed === "true" ? tr("ثُبّت الموعد؛ لن تغيّره الجدولة التالية", "Time fixed; the next run won't change it") : tr("أُلغي التثبيت", "Time unfixed")),
  "cancel-request": async (b) => {
    const r = X.req.get(Number(b.dataset.id));
    const team = nm(X.team.get(r.team_id)?.name);
    const booked = X.asg.has(r.id);
    if (await ask(tr("إلغاء طلب الحجز", "Cancel booking request"),
      tr(`سيُحذف الطلب رقم ${r.id} للفريق «${team}»${booked ? " ويُحرَّر موعده في الجدول" : ""}.`, `Request ${r.id} for “${team}” will be deleted${booked ? " and its slot freed" : ""}.`),
      tr("إلغاء الطلب", "Cancel request")))
      if (await act("DELETE", `/api/requests/${r.id}`, null, tr("أُلغي طلب الحجز", "Request cancelled"))) closeDrawer();
  },

  form: (b) => openForm(b.dataset.form, b.dataset.id ? Number(b.dataset.id) : undefined, b.dataset),
  "dialog-close": () => $("#dialog").close(),

  "toggle-facility": async (b) => {
    const f = X.fac.get(Number(b.dataset.id));
    const toActive = b.dataset.active === "true";
    if (!toActive && !(await ask(tr(`إخراج ${iso(f.name)} من الخدمة`, `Take ${iso(f.name)} out of service`),
      tr(`لن تُجدوَل عليه جلسات. حجوزاته الحالية (${sessionsOn(f)}) تُنقل إلى مرافق مماثلة عند تشغيل الجدولة.`, `No sessions will be scheduled on it. Its current bookings (${sessionsOn(f)}) move to similar facilities when you generate the schedule.`),
      tr("إخراج من الخدمة", "Take out of service")))) return;
    await act("PATCH", `/api/facilities/${f.id}`, { active: toActive }, toActive ? tr("أُعيد المرفق إلى الخدمة", "Facility back in service") : tr("أُخرج المرفق من الخدمة. شغّل الجدولة لنقل حجوزاته.", "Facility out of service. Generate the schedule to move its bookings."));
  },
  "delete-facility": async (b) => {
    const f = X.fac.get(Number(b.dataset.id));
    if (await ask(tr(`حذف ${iso(f.name)}`, `Delete ${iso(f.name)}`),
      tr(`يُحذف المرفق نهائياً مع حجوزاته (${sessionsOn(f)}) وفترات إغلاقه. لإيقافه مؤقتاً استخدم «إخراج من الخدمة».`, `The facility is deleted permanently with its bookings (${sessionsOn(f)}) and closures. To pause it, use “Take out of service”.`),
      tr("حذف المرفق", "Delete facility")))
      await act("DELETE", `/api/facilities/${f.id}`, null, tr("حُذف المرفق", "Facility deleted"));
  },
  "delete-team": async (b) => {
    const t = X.team.get(Number(b.dataset.id));
    const n = S.requests.filter((r) => r.team_id === t.id).length;
    if (await ask(tr(`حذف ${iso(t.name)}`, `Delete ${iso(t.name)}`), tr(`يُحذف الفريق مع طلباته (${n}) وحجوزاته نهائياً.`, `The team is deleted permanently with its requests (${n}) and bookings.`), tr("حذف الفريق", "Delete team")))
      await act("DELETE", `/api/teams/${t.id}`, null, tr("حُذف الفريق", "Team deleted"));
  },
  "delete-closure": (b) => act("DELETE", `/api/closures/${b.dataset.id}`, null, tr("أُلغيت فترة الإغلاق", "Closure removed")),
  "delete-user": async (b) => {
    const u = S.users.find((x) => x.id === Number(b.dataset.id));
    if (await ask(tr(`حذف ${iso(u.full_name)}`, `Delete ${iso(u.full_name)}`), tr("لن يتمكن من الدخول بعد الآن. تبقى عملياته السابقة في سجل النشاط.", "They won't be able to sign in. Their past operations stay in the activity log."), tr("حذف المستخدم", "Delete user")))
      await act("DELETE", `/api/users/${u.id}`, null, tr("حُذف المستخدم", "User deleted"));
  },

  csv: () => exportCsv(),
  print: () => window.print(),
  "load-demo": async () => {
    if (S.facilities.length && !(await ask(tr("تحميل البيانات التجريبية", "Load demo data"), tr("ستُستبدل المرافق والفرق والطلبات الحالية بالبيانات التجريبية.", "Current facilities, teams and requests will be replaced by the demo data."), tr("تحميل", "Load"), false))) return;
    if (await act("POST", "/api/data/demo", null, tr("حُمّلت البيانات التجريبية. اضغط «تشغيل الجدولة».", "Demo data loaded. Press “Generate schedule”."))) location.hash = "#dashboard";
  },
  "clear-data": async () => {
    if (await ask(tr("حذف جميع البيانات", "Delete all data"), tr("تُحذف كل المرافق والفرق والطلبات والحجوزات نهائياً. يبقى المستخدمون وسجل النشاط.", "All facilities, teams, requests and bookings are deleted permanently. Users and the activity log stay."), tr("حذف الكل", "Delete everything")))
      await act("POST", "/api/data/clear", null, tr("حُذفت جميع البيانات", "All data deleted"));
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !ACTIONS[el.dataset.action]) return;
  if (el.tagName === "A" && el.dataset.action !== "req-filter") e.preventDefault();
  ACTIONS[el.dataset.action](el);
});

document.addEventListener("change", async (e) => {
  const k = e.target.dataset.change;
  if (k === "sched-team") { ui.sched.team = Number(e.target.value); render(); }
  else if (k === "req-type") { ui.req.type = e.target.value; renderRequestList(); }
  else if (k === "public-board") {
    const on = e.target.checked;
    await act("PUT", "/api/settings", { orgName: S.settings.orgName, publicBoard: on }, on ? tr("فُعّلت لوحة العرض العامة", "Public board turned on") : tr("أُوقفت لوحة العرض العامة", "Public board turned off"));
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "req-q") { ui.req.q = e.target.value; renderRequestList(); }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "org-form") return act("PUT", "/api/settings", { orgName: data.orgName, publicBoard: S.settings.publicBoard === "on" }, tr("حُفظ اسم المؤسسة", "Organisation name saved"));
  if (form.id === "password-form") { if (await act("PUT", "/api/password", data, tr("تغيّرت كلمة المرور", "Password changed"))) form.reset(); return; }
  if (!form.dataset.form) return;
  // نماذج النوافذ: الخطأ يظهر داخل النافذة نفسها
  const f = FORMS[form.dataset.form](form.dataset.id ? Number(form.dataset.id) : undefined, {});
  const error = form.querySelector(".form-error");
  const button = form.querySelector("button[value=ok]");
  button.disabled = true;
  try {
    S = await api(f.method, f.path, data);
    $("#dialog").close();
    render();
    toast(typeof f.done === "function" ? f.done(S, data) : f.done);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.drawer && !document.querySelector("dialog[open]")) closeDrawer();
});
window.addEventListener("hashchange", () => {
  document.getElementById("app").classList.remove("nav-open");
  ui.drawer = null;
  render();
  $("#page").focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

api("GET", "/api/state").then((s) => { S = s; render(); }).catch((err) => toast(err.message, true));
