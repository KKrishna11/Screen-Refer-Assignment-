// Indian mobile numbers arrive as "+91 98765 43210", "098765-43210", "9876543210",
// "91 9876543210", sometimes with Devanagari digits (९८७६...). Store one canonical form:
// exactly 10 digits, starting 6–9.

const DEVANAGARI_ZERO = 0x0966;

function toAsciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (ch) => String(ch.charCodeAt(0) - DEVANAGARI_ZERO));
}

export type PhoneResult = { ok: true; phone: string } | { ok: false; error: string };

export function normalizePhone(input: string): PhoneResult {
  const raw = toAsciiDigits(String(input ?? "")).trim();
  if (!raw) return { ok: false, error: "Phone number is required" };
  if (/[^\d\s()+\-.]/.test(raw)) return { ok: false, error: "Phone number has invalid characters" };

  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  else if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);

  if (digits.length !== 10) return { ok: false, error: "Enter a 10-digit mobile number" };
  if (!/^[6-9]/.test(digits)) return { ok: false, error: "Indian mobile numbers start with 6, 7, 8 or 9" };
  return { ok: true, phone: digits };
}

// For search boxes: turn whatever was typed into the digits we'd store, but allow partial numbers.
export function phoneSearchDigits(q: string): string | null {
  const ascii = toAsciiDigits(q).trim();
  if (!/^[\d\s()+\-.]+$/.test(ascii)) return null;
  const full = normalizePhone(ascii);
  if (full.ok) return full.phone;
  const digits = ascii.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

export function formatPhone(p: string): string {
  return p.length === 10 ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : p;
}
