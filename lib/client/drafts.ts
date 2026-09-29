"use client";

// Screening drafts are saved to the phone's localStorage on every tap, so a refresh,
// a dead battery or a dropped connection never loses answers. Each draft carries a
// clientId generated once, so re-sending the same draft can never create two screenings.

import { api } from "./api";

export type Draft = {
  clientId: string;
  patientId: string;
  patient: { fullName: string; dob: string; sex: "MALE" | "FEMALE" | "OTHER" };
  answers: Record<string, unknown>;
  updatedAt: number;
  queued: boolean; // true = worker pressed Submit but it hasn't reached the server yet
};

const PREFIX = "sr:draft:v1:";
const key = (userId: string, patientId: string) => `${PREFIX}${userId}:${patientId}`;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback; // private mode / storage full / disabled
  }
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function loadDraft(userId: string, patientId: string): Draft | null {
  return safe(() => {
    const raw = localStorage.getItem(key(userId, patientId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  }, null);
}

export function saveDraft(userId: string, d: Draft): boolean {
  return safe(() => {
    localStorage.setItem(key(userId, d.patientId), JSON.stringify({ ...d, updatedAt: Date.now() }));
    return true;
  }, false);
}

export function clearDraft(userId: string, patientId: string) {
  safe(() => localStorage.removeItem(key(userId, patientId)), undefined);
}

export function listDrafts(userId: string): Draft[] {
  return safe(() => {
    const out: Draft[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${PREFIX}${userId}:`)) {
        const d = JSON.parse(localStorage.getItem(k) || "null") as Draft | null;
        if (d) out.push(d);
      }
    }
    return out;
  }, []);
}

// Try to send one draft. Resolves to the new screening id, or throws ApiError.
export async function submitDraft(userId: string, d: Draft): Promise<string> {
  const res = await api<{ screening: { id: string } }>("/api/screenings", {
    method: "POST",
    body: { clientId: d.clientId, patientId: d.patientId, answers: d.answers },
  });
  clearDraft(userId, d.patientId);
  return res.screening.id;
}
