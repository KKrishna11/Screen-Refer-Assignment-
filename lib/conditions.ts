// A tiny condition language shared by the form config (showIf) and the risk rules (when).
// Pure functions, no I/O — the same file runs in the browser and on the server.

export type Op =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "includesAny"
  | "answered";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: Op; value?: unknown };

// Facts are flat: "age", "ageMonths", "sex", "q.<questionId>"
export type Facts = Record<string, unknown>;

export function evaluate(cond: Condition | undefined, facts: Facts): boolean {
  if (!cond) return true;
  if ("all" in cond) return cond.all.every((c) => evaluate(c, facts));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, facts));
  if ("not" in cond) return !evaluate(cond.not, facts);

  const actual = facts[cond.fact];
  // A fact that is not present (unanswered or hidden question) never matches,
  // except for an explicit "not answered" check via { not: { op: "answered" } }.
  if (cond.op === "answered") return actual !== undefined && actual !== null && actual !== "";
  if (actual === undefined || actual === null) return false;

  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "neq":
      return actual !== cond.value;
    case "gt":
      return typeof actual === "number" && actual > Number(cond.value);
    case "gte":
      return typeof actual === "number" && actual >= Number(cond.value);
    case "lt":
      return typeof actual === "number" && actual < Number(cond.value);
    case "lte":
      return typeof actual === "number" && actual <= Number(cond.value);
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case "includesAny":
      return (
        Array.isArray(actual) &&
        Array.isArray(cond.value) &&
        actual.some((v) => (cond.value as unknown[]).includes(v))
      );
    default:
      return false;
  }
}

// Every fact name a condition refers to — used to validate config ordering.
export function factsReferenced(cond: Condition | undefined): string[] {
  if (!cond) return [];
  if ("all" in cond) return cond.all.flatMap(factsReferenced);
  if ("any" in cond) return cond.any.flatMap(factsReferenced);
  if ("not" in cond) return factsReferenced(cond.not);
  return [cond.fact];
}
