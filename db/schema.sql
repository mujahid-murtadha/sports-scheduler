-- مخطط قاعدة البيانات (PostgreSQL)
-- يُنفَّذ تلقائياً عند تشغيل الخادم؛ IF NOT EXISTS تجعله آمناً عند كل تشغيل

-- المرافق: الملاعب والصالات
CREATE TABLE IF NOT EXISTS facilities (
  id          SERIAL  PRIMARY KEY,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,                -- football | basketball | volleyball | tennis | handball
  open_hour   INTEGER NOT NULL CHECK (open_hour BETWEEN 0 AND 23),
  close_hour  INTEGER NOT NULL CHECK (close_hour BETWEEN 1 AND 24),
  active      BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = خارج الخدمة
  CHECK (open_hour < close_hour)
);

-- فترات الإغلاق: ساعات محددة لا يُحجز فيها المرفق (صيانة، مباراة رسمية، فعالية)
CREATE TABLE IF NOT EXISTS closures (
  id           SERIAL  PRIMARY KEY,
  facility_id  INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  day          INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  from_hour    INTEGER NOT NULL CHECK (from_hour BETWEEN 0 AND 23),
  to_hour      INTEGER NOT NULL CHECK (to_hour BETWEEN 1 AND 24),
  reason       TEXT    NOT NULL,
  CHECK (from_hour < to_hour)
);

-- الفرق وبيانات الاتصال بمسؤوليها
CREATE TABLE IF NOT EXISTS teams (
  id     SERIAL PRIMARY KEY,
  name   TEXT   NOT NULL UNIQUE,
  coach  TEXT,
  phone  TEXT
);

-- الطلب = جلسة واحدة. ترتيب الوصول هو ترتيب id
CREATE TABLE IF NOT EXISTS requests (
  id                 SERIAL      PRIMARY KEY,
  team_id            INTEGER     NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  facility_type      TEXT        NOT NULL,
  pref_day           INTEGER     CHECK (pref_day BETWEEN 0 AND 6),
  pref_hour          INTEGER     CHECK (pref_hour BETWEEN 0 AND 23),
  -- الموعد المثبّت من الإدارة (اختياري): يحترمه المحرّك ولا يغيّره
  fixed_facility_id  INTEGER     REFERENCES facilities(id) ON DELETE SET NULL,
  fixed_day          INTEGER     CHECK (fixed_day BETWEEN 0 AND 6),
  fixed_hour         INTEGER     CHECK (fixed_hour BETWEEN 0 AND 23),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((pref_day IS NULL) = (pref_hour IS NULL))
);

-- ناتج المحرّك. القيدان UNIQUE يمنعان التعارض على مستوى قاعدة البيانات نفسها
CREATE TABLE IF NOT EXISTS assignments (
  request_id          INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  team_id             INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  facility_id         INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  day                 INTEGER NOT NULL,
  hour                INTEGER NOT NULL,
  matched_preference  BOOLEAN NOT NULL,
  reason              TEXT    NOT NULL,   -- رمز سبب التخصيص (تترجمه الواجهة)
  reason_args         JSONB,              -- معطيات السبب، مثل أسماء الفرق التي شغلت الوقت المفضّل
  UNIQUE (facility_id, day, hour),
  UNIQUE (team_id, day, hour)
);

-- الطلبات التي تعذّرت جدولتها وسبب كل منها
CREATE TABLE IF NOT EXISTS unscheduled (
  request_id   INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  reason       TEXT  NOT NULL,   -- رمز سبب عدم الجدولة
  reason_args  JSONB
);

-- سجل تشغيلات المحرّك ومؤشراتها
CREATE TABLE IF NOT EXISTS runs (
  id           SERIAL      PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  username     TEXT        NOT NULL,
  duration_ms  REAL        NOT NULL,
  moved        INTEGER     NOT NULL,   -- عدد الحجوزات التي تغيّر موضعها عن الجدول السابق
  metrics      JSONB       NOT NULL,   -- مؤشرات المحرّك
  baseline     JSONB       NOT NULL,   -- مؤشرات التوزيع بالأسبقية على البيانات نفسها
  stats        JSONB       NOT NULL    -- خطوات البحث والتراجع
);

-- مستخدمو النظام (كلمة المرور تُخزَّن مشفّرة بـ scrypt، لا نصاً صريحاً)
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL      PRIMARY KEY,
  username       TEXT        NOT NULL UNIQUE,
  full_name      TEXT        NOT NULL,
  password_hash  TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- جلسات الدخول
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT        PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- سجل النشاط (مسار التدقيق): من فعل ماذا ومتى. يُحفظ اسم المستخدم نصاً ليبقى السجل بعد حذف الحساب
CREATE TABLE IF NOT EXISTS activity (
  id        SERIAL      PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  username  TEXT        NOT NULL,
  action    TEXT        NOT NULL,                 -- رمز العملية، مثل closure_added
  params    JSONB       NOT NULL DEFAULT '{}'     -- تفاصيلها: أسماء المرافق والفرق والأوقات
);

-- إعدادات النظام (اسم المؤسسة، لوحة العرض العامة)
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
