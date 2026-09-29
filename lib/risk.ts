// Risk scoring rules live in config/risk-rules.json. This file only applies them.
// Only called on the server — the browser never computes the risk it shows.

import rulesJson from "@/config/risk-rules.json";
import { evaluate, type Condition, type Facts } from "./conditions";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type Rule = { id: string; when: Condition; points?: number; redFlag?: boolean; reason: string };
type RuleSet = { version: string; thresholds: { medium: number; high: number }; rules: Rule[] };

export const ruleSet = rulesJson as RuleSet;

export type RiskReason = { id: string; reason: string; points: number; redFlag: boolean };
export type RiskResult = { score: number; level: RiskLevel; reasons: RiskReason[]; rulesVersion: string };

export function scoreRisk(facts: Facts, rules: RuleSet = ruleSet): RiskResult {
  const reasons: RiskReason[] = [];
  for (const r of rules.rules) {
    if (evaluate(r.when, facts)) {
      reasons.push({ id: r.id, reason: r.reason, points: r.points ?? 0, redFlag: !!r.redFlag });
    }
  }
  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  const anyRedFlag = reasons.some((r) => r.redFlag);
  const level: RiskLevel =
    anyRedFlag || score >= rules.thresholds.high ? "HIGH" : score >= rules.thresholds.medium ? "MEDIUM" : "LOW";
  return { score, level, reasons, rulesVersion: rules.version };
}
