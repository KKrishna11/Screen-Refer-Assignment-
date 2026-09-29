// Pure glue: patient + answers + date -> everything we store about a screening.

import { ageOn } from "./age";
import { evaluateForm, form, type Answers } from "./form-engine";
import { scoreRisk, type RiskResult } from "./risk";

export type PatientFacts = { dob: Date; sex: "MALE" | "FEMALE" | "OTHER" };

export type ComputedScreening = RiskResult & {
  ageYears: number;
  active: Answers;
  hidden: Answers;
  missing: string[];
  errors: Record<string, string>;
  formVersion: string;
};

export function computeScreening(patient: PatientFacts, answers: Record<string, unknown>, at: Date): ComputedScreening {
  const age = ageOn(patient.dob, at);
  const ev = evaluateForm(answers, { ageYears: age.years, ageMonths: age.months, sex: patient.sex });
  const risk = scoreRisk(ev.facts);
  return {
    ...risk,
    ageYears: age.years,
    active: ev.active,
    hidden: ev.hidden,
    missing: ev.missing,
    errors: ev.errors,
    formVersion: form.version,
  };
}
