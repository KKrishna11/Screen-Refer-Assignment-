// Names: accept any script (Devanagari, Latin, Tamil, …). We keep exactly what was typed
// (NFC-normalised so the same visible text is always the same bytes) for display,
// plus a "key" used for search and duplicate hints.

// letters + combining marks (Devanagari matras, nukta, virama are \p{M}),
// spaces, dot, apostrophe, hyphen, and ZWJ/ZWNJ which some Indic keyboards insert.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'\-‌‍]*$/u;

export function cleanName(input: string): string {
  return String(input ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function validateName(name: string): string | null {
  if (!name) return "Name is required";
  if (Array.from(name).length > 160) return "Name is too long";
  if (!NAME_RE.test(name)) return "Name can only contain letters, spaces, dots, apostrophes and hyphens";
  return null;
}

export function nameKey(name: string): string {
  return cleanName(name).toLowerCase();
}

// Rough spelling folding for Latin-script Indian names so "Suneeta", "Sunitha" and
// "Sunita" land close together. Devanagari is left as-is (it is already phonetic).
function fold(key: string): string {
  let s = key.replace(/[\s.'\-‌‍]/g, "");
  if (!/[a-z]/.test(s)) return s;
  s = s
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/([bcdgjkpt])h/g, "$1")
    .replace(/(.)\1+/g, "$1")
    .replace(/a$/, "");
  return s;
}

function levenshtein(a: string[], b: string[]): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// 0..1, where 1 = same after folding
export function nameSimilarity(a: string, b: string): number {
  const fa = Array.from(fold(nameKey(a)));
  const fb = Array.from(fold(nameKey(b)));
  const max = Math.max(fa.length, fb.length);
  if (max === 0) return 1;
  return 1 - levenshtein(fa, fb) / max;
}
