// Age helpers. Dates of birth are calendar dates, so everything is done in UTC
// to avoid off-by-one-day bugs between India (UTC+5:30) and a UTC server.

export function parseDateOnly(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  // reject 2024-02-31 style dates that JS silently rolls over
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ageOn(dob: Date, at: Date): { years: number; months: number } {
  let months =
    (at.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (at.getUTCMonth() - dob.getUTCMonth());
  if (at.getUTCDate() < dob.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months };
}

export function validateDob(dob: Date, now = new Date()): string | null {
  if (dob.getTime() > now.getTime()) return "Date of birth cannot be in the future";
  if (ageOn(dob, now).years > 120) return "Date of birth is more than 120 years ago";
  return null;
}
