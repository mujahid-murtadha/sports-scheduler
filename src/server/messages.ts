// رسائل الخادم للمستخدم باللغتين؛ تُختار حسب لغة الواجهة (الترويسة X-Lang)
type Dict = Record<string, string>;

const ar: Dict = {
  required: "{label} مطلوب",
  range: "{label} يجب أن يكون رقماً بين {min} و{max}",
  bad_login: "اسم المستخدم أو كلمة المرور غير صحيحة",
  session_expired: "انتهت الجلسة. سجّل الدخول من جديد.",
  unknown_type: "نوع المرفق غير معروف",
  close_after_open: "ساعة الإغلاق يجب أن تكون بعد ساعة الفتح",
  closure_end_after_start: "نهاية الإغلاق يجب أن تكون بعد بدايته",
  facility_not_found: "المرفق غير موجود",
  team_exists: "يوجد فريق مسجّل بهذا الاسم",
  no_requests: "لا توجد طلبات لجدولتها. أضف طلباً أولاً.",
  schedule_rejected: "رُفض الجدول: المدقّق وجد خرقاً للقيود الصلبة",
  request_not_found: "الطلب غير موجود",
  no_booking: "لا يوجد حجز لهذا الطلب",
  place_conflict: "لا يمكن الحجز في هذا الموضع: {reason}",
  wrong_password: "كلمة المرور الحالية غير صحيحة",
  password_short: "كلمة المرور يجب ألا تقل عن 8 أحرف",
  username_format: "اسم المستخدم: 3 إلى 30 حرفاً لاتينياً أو رقماً",
  username_taken: "اسم المستخدم مستخدَم من قبل",
  cannot_delete_self: "لا يمكنك حذف حسابك وأنت مسجّل الدخول به",
  board_disabled: "لوحة العرض غير مفعّلة",
  server_error: "حدث خطأ في الخادم. راجع سجل التشغيل.",
  // أسباب رفض الموضع اليدوي
  "conflict.no_facility": "المرفق غير موجود أو خارج الخدمة",
  "conflict.type_mismatch": "نوع المرفق لا يطابق نوع الطلب",
  "conflict.outside_hours": "الفترة خارج ساعات تشغيل المرفق",
  "conflict.closed": "المرفق مغلق في هذه الفترة",
  "conflict.slot_taken": "الفترة محجوزة لفريق {team}",
  "conflict.team_busy_slot": "للفريق جلسة أخرى في الوقت نفسه",
  // أسماء الحقول
  "label.username": "اسم المستخدم", "label.password": "كلمة المرور", "label.facility_name": "اسم المرفق",
  "label.facility_type": "نوع المرفق", "label.open_hour": "ساعة الفتح", "label.close_hour": "ساعة الإغلاق",
  "label.day": "اليوم", "label.from_hour": "بداية الإغلاق", "label.to_hour": "نهاية الإغلاق", "label.closure_reason": "سبب الإغلاق",
  "label.team_name": "اسم الفريق", "label.pref_day": "اليوم المفضّل", "label.pref_hour": "الساعة المفضّلة",
  "label.count": "عدد الجلسات", "label.hour": "الساعة", "label.org_name": "اسم المؤسسة", "label.new_password": "كلمة المرور الجديدة",
  "label.current_password": "كلمة المرور الحالية", "label.full_name": "الاسم الكامل", "label.id": "المعرّف",
};

const en: Dict = {
  required: "{label} is required",
  range: "{label} must be a number between {min} and {max}",
  bad_login: "Incorrect username or password",
  session_expired: "Your session has ended. Sign in again.",
  unknown_type: "Unknown facility type",
  close_after_open: "Closing hour must be after opening hour",
  closure_end_after_start: "Closure end must be after its start",
  facility_not_found: "Facility not found",
  team_exists: "A team with this name already exists",
  no_requests: "There are no requests to schedule. Add a request first.",
  schedule_rejected: "Schedule rejected: the validator found a hard-constraint violation",
  request_not_found: "Request not found",
  no_booking: "This request has no booking",
  place_conflict: "This slot can't be booked: {reason}",
  wrong_password: "Current password is incorrect",
  password_short: "Password must be at least 8 characters",
  username_format: "Username: 3 to 30 Latin letters or digits",
  username_taken: "This username is already taken",
  cannot_delete_self: "You can't delete the account you're signed in with",
  board_disabled: "The public board is turned off",
  server_error: "Server error. Check the server log.",
  "conflict.no_facility": "the facility doesn't exist or is out of service",
  "conflict.type_mismatch": "the facility type doesn't match the request",
  "conflict.outside_hours": "the slot is outside the facility's hours",
  "conflict.closed": "the facility is closed at that time",
  "conflict.slot_taken": "the slot is booked by {team}",
  "conflict.team_busy_slot": "the team has another session at that time",
  "label.username": "Username", "label.password": "Password", "label.facility_name": "Facility name",
  "label.facility_type": "Facility type", "label.open_hour": "Opening hour", "label.close_hour": "Closing hour",
  "label.day": "Day", "label.from_hour": "Closure start", "label.to_hour": "Closure end", "label.closure_reason": "Closure reason",
  "label.team_name": "Team name", "label.pref_day": "Preferred day", "label.pref_hour": "Preferred hour",
  "label.count": "Number of sessions", "label.hour": "Hour", "label.org_name": "Organisation name", "label.new_password": "New password",
  "label.current_password": "Current password", "label.full_name": "Full name", "label.id": "ID",
};

export type Lang = "ar" | "en";

export function message(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const dict = lang === "en" ? en : ar;
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    // المعطى قد يكون مفتاحاً آخر (اسم حقل أو سبب رفض) فيُترجم أيضاً
    return typeof v === "string" && dict[v] ? dict[v] : String(v ?? "");
  });
  return fill(dict[key] ?? key);
}
