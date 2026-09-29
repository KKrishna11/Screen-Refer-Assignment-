import { describe, expect, it } from "vitest";
import { normalizePhone, phoneSearchDigits } from "@/lib/phone";
import { cleanName, nameKey, nameSimilarity, validateName } from "@/lib/names";
import { ageOn, parseDateOnly } from "@/lib/age";
import { assertConfigValid, evaluateForm, form, type Subject } from "@/lib/form-engine";
import { scoreRisk } from "@/lib/risk";
import { computeScreening } from "@/lib/screening";
import { validateSummary } from "@/lib/ai-validate";
import { createSessionToken, verifySessionToken } from "@/lib/server/session";

describe("phone numbers", () => {
  it.each([
    ["+91 98765 43210", "9876543210"],
    ["+91-98765-43210", "9876543210"],
    ["098765 43210", "9876543210"],
    ["9876543210", "9876543210"],
    ["91 9876543210", "9876543210"],
    ["(0) 98765-43210", "9876543210"],
    ["९८७६५४३२१०", "9876543210"],
  ])("%s -> %s", (input, out) => {
    expect(normalizePhone(input)).toEqual({ ok: true, phone: out });
  });

  it("rejects bad numbers", () => {
    expect(normalizePhone("12345").ok).toBe(false);
    expect(normalizePhone("5876543210").ok).toBe(false); // must start 6-9
    expect(normalizePhone("98765abc10").ok).toBe(false);
    expect(normalizePhone("").ok).toBe(false);
  });

  it("search accepts partial and full numbers in any format", () => {
    expect(phoneSearchDigits("+91 98765 43210")).toBe("9876543210");
    expect(phoneSearchDigits("98765")).toBe("98765");
    expect(phoneSearchDigits("Sunita")).toBeNull();
  });
});

describe("names", () => {
  it("accepts Devanagari (with matras, nukta, virama)", () => {
    for (const n of ["सुनीता देवी", "क़ासिम", "लक्ष्मी", "श्रीमती प्रज्ञा"]) expect(validateName(cleanName(n))).toBeNull();
  });
  it("NFC-normalises so the same visible name has one form", () => {
    const decomposed = "क़"; // क + nukta
    const composed = "क़"; // क़
    expect(nameKey(decomposed)).toBe(nameKey(composed));
  });
  it("rejects digits and symbols", () => {
    expect(validateName("Sunita123")).not.toBeNull();
    expect(validateName("<script>")).not.toBeNull();
  });
  it("scores spelling variants as similar", () => {
    expect(nameSimilarity("Sunita Devi", "Suneeta Devi")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("Sunita Devi", "Sunitha  devi")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("Sunita Devi", "Ramesh Jadhav")).toBeLessThan(0.4);
  });
});

describe("age", () => {
  it("handles birthdays correctly", () => {
    const dob = parseDateOnly("2020-06-20")!;
    expect(ageOn(dob, new Date("2026-06-19T12:00:00Z")).years).toBe(5);
    expect(ageOn(dob, new Date("2026-06-20T00:00:00Z")).years).toBe(6);
  });
  it("rejects impossible dates", () => {
    expect(parseDateOnly("2024-02-31")).toBeNull();
    expect(parseDateOnly("12/04/1988")).toBeNull();
  });
});

const adultWoman: Subject = { ageYears: 28, ageMonths: 28 * 12, sex: "FEMALE" };
const girl6: Subject = { ageYears: 6, ageMonths: 72, sex: "FEMALE" };
const man40: Subject = { ageYears: 40, ageMonths: 480, sex: "MALE" };
const baby: Subject = { ageYears: 1, ageMonths: 14, sex: "MALE" };

describe("branching form", () => {
  it("config is valid and has ~15-20 questions", () => {
    expect(() => assertConfigValid(form)).not.toThrow();
    const n = form.sections.reduce((a, s) => a + s.questions.length, 0);
    expect(n).toBeGreaterThanOrEqual(15);
  });

  it("no menstrual questions for a 6-year-old girl or an adult man", () => {
    for (const subj of [girl6, man40]) {
      const ev = evaluateForm({ periods_started: "yes" }, subj);
      expect(ev.visibleSections).not.toContain("women");
      expect(ev.visibleQuestions).not.toContain("periods_started");
    }
    expect(evaluateForm({}, adultWoman).visibleQuestions).toContain("periods_started");
  });

  it("child section only for under-5s; MUAC only from 6 months", () => {
    expect(evaluateForm({}, baby).visibleQuestions).toEqual(expect.arrayContaining(["muac", "vaccination"]));
    expect(evaluateForm({}, { ageYears: 0, ageMonths: 3, sex: "FEMALE" }).visibleQuestions).not.toContain("muac");
    expect(evaluateForm({}, man40).visibleSections).not.toContain("child");
  });

  it("follow-ups appear only after the answer that triggers them", () => {
    expect(evaluateForm({ cough: "no" }, man40).visibleQuestions).not.toContain("cough_duration");
    expect(evaluateForm({ cough: "yes" }, man40).visibleQuestions).toContain("cough_duration");
  });

  it("changing an answer hides follow-ups, keeps their answers aside, and doesn't score them", () => {
    const answers = { cough: "no", cough_duration: "gte2w", blood_sputum: "yes" };
    const ev = evaluateForm(answers, man40);
    expect(ev.active).not.toHaveProperty("blood_sputum");
    expect(ev.hidden).toEqual({ cough_duration: "gte2w", blood_sputum: "yes" });
    expect(scoreRisk(ev.facts).reasons.map((r) => r.id)).not.toContain("blood_sputum");
  });

  it("hiding cascades: a hidden parent's stale answer can't reveal its child", () => {
    // pregnant is hidden when periods_started = no; its stale 'yes' must not reveal danger_signs
    const ev = evaluateForm({ periods_started: "no", pregnant: "yes", danger_signs: ["bleeding"] }, adultWoman);
    expect(ev.visibleQuestions).not.toContain("pregnant");
    expect(ev.visibleQuestions).not.toContain("danger_signs");
    expect(Object.keys(ev.hidden).sort()).toEqual(["danger_signs", "pregnant"]);
  });

  it("validates answer values", () => {
    const ev = evaluateForm({ fever: "maybe", cough: "no", breathless: "no" }, baby);
    expect(ev.errors.fever).toBeDefined();
    const ev2 = evaluateForm({ fever: "yes", fever_days: 900 }, man40);
    expect(ev2.errors.fever_days).toBeDefined();
    const ev3 = evaluateForm({ periods_started: "yes", pregnant: "yes", danger_signs: ["none", "bleeding"] }, adultWoman);
    expect(ev3.errors.danger_signs).toBeDefined();
  });

  it("reports required visible questions that are missing", () => {
    expect(evaluateForm({}, man40).missing).toContain("fever");
  });
});

const fullAdultMale = {
  fever: "no",
  cough: "no",
  breathless: "no",
  weight_loss: "no",
  tobacco: "none",
  bp_measured: "no",
  known_diabetes: "no",
  thirst_urination: "no",
};

describe("risk scoring", () => {
  it("healthy adult = LOW", () => {
    const c = computeScreening({ dob: parseDateOnly("1985-01-01")!, sex: "MALE" }, fullAdultMale, new Date("2026-09-01"));
    expect(c.missing).toEqual([]);
    expect(c.level).toBe("LOW");
  });
  it("points add up to MEDIUM / HIGH", () => {
    const at = new Date("2026-09-01");
    const p = { dob: parseDateOnly("1985-01-01")!, sex: "MALE" as const };
    expect(computeScreening(p, { ...fullAdultMale, cough: "yes", cough_duration: "gte2w", blood_sputum: "no" }, at).level).toBe("MEDIUM");
    expect(
      computeScreening(p, { ...fullAdultMale, cough: "yes", cough_duration: "gte2w", blood_sputum: "no", weight_loss: "yes", tobacco: "smoke" }, at).level,
    ).toBe("HIGH");
  });
  it("any red flag = HIGH", () => {
    const p = { dob: parseDateOnly("1985-01-01")!, sex: "MALE" as const };
    const c = computeScreening(p, { ...fullAdultMale, bp_measured: "yes", bp_systolic: 190, bp_diastolic: 100 }, new Date("2026-09-01"));
    expect(c.level).toBe("HIGH");
    expect(c.reasons.find((r) => r.id === "bp_very_high")?.redFlag).toBe(true);
  });
});

describe("DOB corrected after screening", () => {
  // Screened as a 28-year-old woman, pregnant with a danger sign -> HIGH.
  const answers = {
    fever: "no", cough: "no", breathless: "no", weight_loss: "no", tobacco: "none",
    bp_measured: "no", known_diabetes: "no", thirst_urination: "no",
    periods_started: "yes", periods_pattern: "regular", pregnant: "yes", pregnancy_months: 6, danger_signs: ["swelling"],
  };
  const at = new Date("2026-09-01");

  it("re-evaluating with a corrected DOB moves inapplicable answers aside and re-scores", () => {
    const before = computeScreening({ dob: parseDateOnly("1998-03-10")!, sex: "FEMALE" }, answers, at);
    expect(before.level).toBe("HIGH");
    // DOB was actually 2019 -> 7-year-old: women's and adult sections no longer apply
    const after = computeScreening({ dob: parseDateOnly("2019-03-10")!, sex: "FEMALE" }, answers, at);
    expect(after.ageYears).toBe(7);
    expect(after.hidden).toHaveProperty("danger_signs");
    expect(after.hidden).toHaveProperty("bp_measured");
    expect(after.level).toBe("LOW");
    // correcting back restores everything — nothing was lost
    const back = computeScreening({ dob: parseDateOnly("1998-03-10")!, sex: "FEMALE" }, { ...after.hidden, ...after.active }, at);
    expect(back.level).toBe("HIGH");
    expect(back.active).toEqual(before.active);
  });

  it("questions that newly apply are reported as missing, not invented", () => {
    // screened as a 3-year-old, DOB corrected to an adult
    const child = { fever: "no", cough: "no", breathless: "no", muac: "green", vaccination: "complete" };
    const after = computeScreening({ dob: parseDateOnly("1990-01-01")!, sex: "MALE" }, child, at);
    expect(after.missing).toEqual(expect.arrayContaining(["weight_loss", "tobacco", "bp_measured", "known_diabetes"]));
    expect(after.hidden).toHaveProperty("muac");
  });
});

describe("AI output checks", () => {
  const good = JSON.stringify({
    english: "Risk level: MEDIUM. Cough for more than two weeks and high blood pressure reading; TB testing and BP recheck are suggested.",
    hindi: "जोखिम स्तर: मध्यम। दो हफ़्ते से ज़्यादा खांसी और बीपी ज़्यादा है; टीबी जांच और बीपी दोबारा नापने की सलाह है।",
  });
  it("accepts a good answer, even with code fences", () => {
    expect(validateSummary(good, "MEDIUM").ok).toBe(true);
    expect(validateSummary("```json\n" + good + "\n```", "MEDIUM").ok).toBe(true);
  });
  it("rejects junk", () => {
    expect(validateSummary("", "LOW").ok).toBe(false);
    expect(validateSummary("Sure! Here is your summary...", "LOW").ok).toBe(false);
    expect(validateSummary(JSON.stringify({ english: "Risk level: LOW. fine", hindi: "ok" }), "LOW").ok).toBe(false);
    // Hindi written in Latin script
    expect(
      validateSummary(JSON.stringify({ english: "Risk level: LOW. Nothing concerning was found in this screening today.", hindi: "Jokhim star kam hai, koi chinta ki baat nahi mili aaj." }), "LOW").ok,
    ).toBe(false);
  });
  it("rejects a summary that states a different risk level than the rules", () => {
    expect(validateSummary(good, "HIGH").ok).toBe(false);
  });
});

describe("session cookie", () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";
  it("round-trips and rejects tampering and expiry", () => {
    const t = createSessionToken("user_1");
    expect(verifySessionToken(t)).toBe("user_1");
    const [data, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "doctor_1", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(`${data}.${sig}x`)).toBeNull();
    expect(verifySessionToken(t, Date.now() + 13 * 3600 * 1000)).toBeNull();
  });
});
