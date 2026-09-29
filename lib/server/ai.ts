// Server-only LLM call. The API key is read from the server environment and never
// sent to the browser. Any failure (no key, network error, timeout, HTTP error,
// junk output) returns { ok: false } — callers never see an exception from here.

import { findQuestion, labelFor, type Answers } from "../form-engine";
import { validateSummary, type ValidSummary } from "../ai-validate";
import type { RiskReason } from "../risk";

export type SummaryInput = {
  ageYears: number;
  sex: string;
  risk: string;
  score: number;
  reasons: RiskReason[];
  answers: Answers;
  missing: string[];
};

export type SummaryResult = { ok: true; value: ValidSummary; model: string } | { ok: false; error: string };

// No name, phone or village is sent to the AI provider — only clinical facts.
export function buildPrompt(i: SummaryInput): string {
  const lines = Object.entries(i.answers).map(([id, v]) => {
    const q = findQuestion(id);
    return q ? `- ${q.label.en} ${labelFor(q, v, "en")}` : `- ${id}: ${String(v)}`;
  });
  const missing = i.missing.map((id) => findQuestion(id)?.label.en ?? id);
  const hiRisk = { LOW: "कम", MEDIUM: "मध्यम", HIGH: "उच्च" }[i.risk] ?? i.risk;
  return [
    "You are helping a doctor in rural India quickly review a community health screening done by a field health worker.",
    "Write a short plain-language summary (3 to 5 sentences) of the screening below.",
    "Rules:",
    `- The English summary MUST begin exactly with "Risk level: ${i.risk}." and the Hindi summary MUST begin exactly with "जोखिम स्तर: ${hiRisk}।"`,
    "- Use only the facts given. Do not add a diagnosis, do not name diseases as certain, do not prescribe medicines.",
    "- Mention the main reasons for the risk level and anything that needs follow-up, including questions that were not asked.",
    "- The Hindi summary must be simple, natural Hindi in Devanagari script (medical terms like BP or TB may stay in English).",
    'Reply with ONLY this JSON object and nothing else: {"english": "...", "hindi": "..."}',
    "",
    "Screening:",
    `Age: ${i.ageYears} years. Sex: ${i.sex}.`,
    `Rule-based risk level (computed by the app, do not change it): ${i.risk} (score ${i.score}).`,
    `Reasons: ${i.reasons.length ? i.reasons.map((r) => r.reason + (r.redFlag ? " [red flag]" : "")).join("; ") : "none"}.`,
    "Answers:",
    ...lines,
    missing.length ? `Not asked (now applicable): ${missing.join("; ")}` : "",
  ].join("\n");
}

function timeoutMs() {
  const n = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 12000;
}

async function callGemini(prompt: string, key: string): Promise<{ text: string; model: string }> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        // 2.5 Flash "thinks" by default and those tokens count against maxOutputTokens;
        // a summary doesn't need it, and turning it off keeps latency low.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { text, model };
}

async function callOpenAI(prompt: string, key: string): Promise<{ text: string; model: string }> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: data.choices?.[0]?.message?.content ?? "", model };
}

export async function generateSummary(input: SummaryInput): Promise<SummaryResult> {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const key = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "AI summary is not configured on the server" };

  try {
    const prompt = buildPrompt(input);
    const { text, model } = provider === "openai" ? await callOpenAI(prompt, key) : await callGemini(prompt, key);
    const checked = validateSummary(text, input.risk);
    if (!checked.ok) return { ok: false, error: `AI returned an unusable answer (${checked.error})` };
    return { ok: true, value: checked.value, model };
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { ok: false, error: "AI service took too long to respond" };
    }
    // never echo raw provider errors (could include request details)
    return { ok: false, error: err.message?.startsWith("AI provider") ? err.message : "Could not reach the AI service" };
  }
}
