// التحقق من مدخلات المستخدم: أي خطأ هنا يصل إلى الواجهة رسالةً مفهومة (رمز 400) بلغة المستخدم

/** خطأ في المدخلات: مفتاح الرسالة ومعطياتها، وتُترجم عند الإرسال (انظر messages.ts) */
export class InputError extends Error {
  constructor(public key: string, public params: Record<string, string | number> = {}) {
    super(key);
  }
}

export const text = (v: unknown, label: string) => {
  if (typeof v !== "string" || !v.trim()) throw new InputError("required", { label: `label.${label}` });
  return v.trim();
};

export const optional = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const int = (v: unknown, label: string, min: number, max: number) => {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isInteger(n) || n < min || n > max)
    throw new InputError("range", { label: `label.${label}`, min, max });
  return n;
};

export const id = (v: unknown) => int(v, "id", 1, 2 ** 31 - 1);
