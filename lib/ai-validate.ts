// Checks an LLM reply before we store or show it. Anything that fails is treated
// exactly like a timeout: the app says the summary is unavailable and carries on.

import { z } from "zod";

const Shape = z.object({ english: z.string(), hindi: z.string() });

export type ValidSummary = { english: string; hindi: string };
export type ValidationResult = { ok: true; value: ValidSummary } | { ok: false; error: string };

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function letters(s: string) {
  return Array.from(s).filter((ch) => /\p{L}/u.test(ch));
}

export function validateSummary(rawText: string, expectedRisk: string): ValidationResult {
  if (!rawText || !rawText.trim()) return { ok: false, error: "empty response" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }
  const shape = Shape.safeParse(parsed);
  if (!shape.success) return { ok: false, error: "response JSON missing english/hindi text" };

  const english = shape.data.english.trim();
  const hindi = shape.data.hindi.normalize("NFC").trim();

  for (const [name, text] of [["English", english], ["Hindi", hindi]] as const) {
    if (text.length < 40) return { ok: false, error: `${name} summary too short` };
    if (text.length > 1500) return { ok: false, error: `${name} summary too long` };
  }

  const hiLetters = letters(hindi);
  const devanagari = hiLetters.filter((ch) => /[ऀ-ॿ]/.test(ch)).length;
  if (hiLetters.length === 0 || devanagari / hiLetters.length < 0.6) {
    return { ok: false, error: "Hindi summary is not in Devanagari" };
  }
  const enLetters = letters(english);
  const latin = enLetters.filter((ch) => /[A-Za-z]/.test(ch)).length;
  if (enLetters.length === 0 || latin / enLetters.length < 0.9) {
    return { ok: false, error: "English summary is not in English" };
  }

  // The model must repeat the server's risk level, not invent its own. We only look at the
  // required opening "Risk level: X" — a word search would trip on "high blood pressure".
  const opening = /^risk level:\s*(low|medium|high)\b/i.exec(english);
  if (!opening || opening[1].toUpperCase() !== expectedRisk.toUpperCase()) {
    return { ok: false, error: "summary does not state the correct risk level" };
  }

  // Stored as plain text and rendered as text (never HTML), but drop stray markup anyway.
  const clean = (t: string) => t.replace(/<[^>]*>/g, "");
  return { ok: true, value: { english: clean(english), hindi: clean(hindi) } };
}
