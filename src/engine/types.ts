// الأنواع الأساسية: كيانات النظام + شكل نتيجة الجدولة

/** المرفق: مكان رياضي له نوع وساعات تشغيل يومية */
export interface Facility {
  id: string;
  name: string;
  type: string; // مثل: "football" | "basketball" | "volleyball"
  openHour: number; // أول ساعة قابلة للحجز (مثلاً 16)
  closeHour: number; // ساعة الإغلاق (مثلاً 22 => آخر فترة 21-22)
}

/** الفريق: الجهة الطالبة */
export interface Team {
  id: string;
  name: string;
}

/** وقت محدد: يوم (0..6) + ساعة بداية الفترة */
export interface TimePoint {
  day: number;
  hour: number;
}

/** الطلب: جلسة واحدة يطلبها فريق على نوع مرفق (هذا هو "المتغيّر" في CSP) */
export interface Request {
  id: string;
  teamId: string;
  facilityType: string;
  preferred?: TimePoint; // الوقت المفضّل (قيد مرن)
  fixed?: SlotValue; // موعد ثبّته المدير يدوياً: يصبح مجال الطلب قيمة واحدة لا يغيّرها المحرّك
}

/** قيمة ممكنة للطلب: مرفق + فترة زمنية (عنصر من "المجال") */
export interface SlotValue {
  facilityId: string;
  day: number;
  hour: number;
}

/** فترة إغلاق: المرفق غير متاح في ساعات محددة من يوم معين (صيانة، مباراة رسمية، فعالية) */
export interface Closure {
  facilityId: string;
  day: number;
  fromHour: number;
  toHour: number; // غير داخلة: إغلاق 18–20 يشمل فترتي 18 و19
}

/**
 * التفسير: رمز السبب ومعطياته. الواجهة تحوّله إلى جملة باللغة المختارة (عربية أو إنجليزية).
 * الرموز: matched, no_pref, taken, team_busy, unavailable, fixed, fixed_lost, manual,
 *         no_type, over_capacity, blocked
 */
export type ReasonArgs = Record<string, string | number | string[]>;

/** الإسناد: طلب وُضع في مرفق وفترة، مع تفسير القرار */
export interface Assignment extends SlotValue {
  requestId: string;
  teamId: string;
  matchedPreference: boolean;
  fixed: boolean; // وُضع في موعده المثبّت
  reason: string; // رمز السبب
  reasonArgs?: ReasonArgs;
}

/** طلب تعذّرت جدولته، مع السبب */
export interface Unscheduled {
  requestId: string;
  teamId: string;
  reason: string; // رمز السبب
  reasonArgs?: ReasonArgs;
}

export interface Problem {
  facilities: Facility[];
  teams: Team[];
  requests: Request[]; // بترتيب الوصول
  days: number; // عدد أيام الجدولة (7 = أسبوع)
  closures?: Closure[];
}

export interface Schedule {
  assignments: Assignment[];
  unscheduled: Unscheduled[];
  stats: { searchSteps: number; backtracks: number; relaxations: number };
}
