"use client";

export const DISCLAIMER = "Screening aid only, not a diagnosis.";

export function Disclaimer() {
  return (
    <div className="disclaimer" role="note">
      {DISCLAIMER}
      <span className="hi" lang="hi">केवल जांच में सहायता, यह निदान नहीं है।</span>
    </div>
  );
}

const RISK_TEXT = {
  LOW: { en: "Low", hi: "कम" },
  MEDIUM: { en: "Medium", hi: "मध्यम" },
  HIGH: { en: "High", hi: "उच्च" },
} as const;

export function RiskBadge({ level, big }: { level: "LOW" | "MEDIUM" | "HIGH"; big?: boolean }) {
  return (
    <span className={`badge risk-${level}${big ? " risk-big" : ""}`}>
      {RISK_TEXT[level].en}
      {big && <span lang="hi"> · {RISK_TEXT[level].hi}</span>}
    </span>
  );
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
      <span className="muted">Page {page} of {totalPages}</span>
      <button className="btn secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}

export function sexLabel(s: string) {
  return s === "MALE" ? "Male" : s === "FEMALE" ? "Female" : "Other";
}

export function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | Date) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// DOB is a calendar date string "YYYY-MM-DD"; format it without timezone shifts
export function fmtDob(dob: string) {
  const [y, m, d] = dob.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
