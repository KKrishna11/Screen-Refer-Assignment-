// The screening form engine. The form is defined in config/screening-form.json;
// this file decides which questions are visible, validates answers and splits
// them into "used" and "hidden". It runs identically in the browser (to render
// the form) and on the server (the server's result is the one that counts).

import formJson from "@/config/screening-form.json";
import { evaluate, factsReferenced, type Condition, type Facts } from "./conditions";

export type Lang = "en" | "hi";
export type Text = Record<Lang, string>;
export type Option = { value: string; label: Text };
export type Question = {
  id: string;
  type: "yesno" | "single" | "multi" | "number";
  required?: boolean;
  label: Text;
  options?: Option[];
  min?: number;
  max?: number;
  unit?: Text;
  exclusive?: string;
  showIf?: Condition;
};
export type Section = { id: string; title: Text; showIf?: Condition; questions: Question[] };
export type FormConfig = { version: string; sections: Section[] };

export type Answer = string | number | string[];
export type Answers = Record<string, Answer>;
export type Subject = { ageYears: number; ageMonths: number; sex: "MALE" | "FEMALE" | "OTHER" };

export const YESNO: Option[] = [
  { value: "yes", label: { en: "Yes", hi: "हाँ" } },
  { value: "no", label: { en: "No", hi: "नहीं" } },
];

export const form = formJson as FormConfig;
assertConfigValid(form);

export function allQuestions(cfg: FormConfig = form): Question[] {
  return cfg.sections.flatMap((s) => s.questions);
}

export function findQuestion(id: string, cfg: FormConfig = form): Question | undefined {
  return allQuestions(cfg).find((q) => q.id === id);
}

export function optionsFor(q: Question): Option[] {
  return q.type === "yesno" ? YESNO : q.options ?? [];
}

/**
 * Conditions may only look at age/sex or at questions that come EARLIER in the form.
 * That lets us decide visibility in one top-to-bottom pass, and guarantees that when
 * a parent question is hidden its follow-ups are hidden too (no stale answers leak).
 */
export function assertConfigValid(cfg: FormConfig): void {
  const seen = new Set<string>();
  const base = new Set(["age", "ageMonths", "sex"]);
  const check = (cond: Condition | undefined, where: string) => {
    for (const f of factsReferenced(cond)) {
      if (base.has(f)) continue;
      const id = f.startsWith("q.") ? f.slice(2) : null;
      if (!id || !seen.has(id)) {
        throw new Error(`Form config error in ${where}: "${f}" must be age, ageMonths, sex or an earlier question`);
      }
    }
  };
  for (const s of cfg.sections) {
    check(s.showIf, `section ${s.id}`);
    for (const q of s.questions) {
      if (seen.has(q.id)) throw new Error(`Form config error: duplicate question id ${q.id}`);
      check(q.showIf, `question ${q.id}`);
      if ((q.type === "single" || q.type === "multi") && !q.options?.length) {
        throw new Error(`Form config error: question ${q.id} needs options`);
      }
      seen.add(q.id);
    }
  }
}

function baseFacts(subject: Subject): Facts {
  return { age: subject.ageYears, ageMonths: subject.ageMonths, sex: subject.sex };
}

// Is this value a well-formed answer to this question?
export function answerError(q: Question, value: unknown): string | null {
  switch (q.type) {
    case "yesno":
    case "single":
      return typeof value === "string" && optionsFor(q).some((o) => o.value === value)
        ? null
        : "Choose one of the options";
    case "multi": {
      if (!Array.isArray(value) || value.length === 0) return "Choose at least one option";
      const allowed = new Set(optionsFor(q).map((o) => o.value));
      if (!value.every((v) => typeof v === "string" && allowed.has(v))) return "Invalid option";
      if (new Set(value).size !== value.length) return "Duplicate option";
      if (q.exclusive && value.includes(q.exclusive) && value.length > 1) {
        return "“None” cannot be combined with other options";
      }
      return null;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number";
      if (q.min !== undefined && value < q.min) return `Must be at least ${q.min}`;
      if (q.max !== undefined && value > q.max) return `Must be at most ${q.max}`;
      return null;
    }
  }
}

export type Evaluation = {
  visibleSections: string[];
  visibleQuestions: string[];
  // answers to visible questions — the only ones used for scoring
  active: Answers;
  // answers the worker gave to questions that are now hidden — kept, never scored
  hidden: Answers;
  // visible + required but unanswered
  missing: string[];
  // visible answers that are malformed
  errors: Record<string, string>;
  // facts (age, sex, q.*) built from active answers — input to the risk rules
  facts: Facts;
};

export function evaluateForm(answers: Record<string, unknown>, subject: Subject, cfg: FormConfig = form): Evaluation {
  const facts: Facts = baseFacts(subject);
  const out: Evaluation = {
    visibleSections: [],
    visibleQuestions: [],
    active: {},
    hidden: {},
    missing: [],
    errors: {},
    facts,
  };

  for (const section of cfg.sections) {
    const sectionVisible = evaluate(section.showIf, facts);
    if (sectionVisible) out.visibleSections.push(section.id);

    for (const q of section.questions) {
      const raw = answers[q.id];
      const hasValue = raw !== undefined && raw !== null && raw !== "" && !(Array.isArray(raw) && raw.length === 0);
      // IMPORTANT: evaluated against `facts`, which only contains answers of questions
      // that were themselves visible. A hidden parent's stale answer can't reveal a child.
      const visible = sectionVisible && evaluate(q.showIf, facts);

      if (!visible) {
        if (hasValue && answerError(q, raw) === null) out.hidden[q.id] = raw as Answer;
        continue;
      }
      out.visibleQuestions.push(q.id);
      if (!hasValue) {
        if (q.required) out.missing.push(q.id);
        continue;
      }
      const err = answerError(q, raw);
      if (err) {
        out.errors[q.id] = err;
        continue;
      }
      out.active[q.id] = raw as Answer;
      facts[`q.${q.id}`] = raw;
    }
  }
  return out;
}

export function labelFor(q: Question, value: Answer, lang: Lang = "en"): string {
  if (q.type === "number") return `${value}${q.unit ? " " + q.unit[lang] : ""}`;
  const opts = optionsFor(q);
  const vals = Array.isArray(value) ? value : [String(value)];
  return vals.map((v) => opts.find((o) => o.value === v)?.label[lang] ?? v).join(", ");
}
