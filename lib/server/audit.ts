import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type AuditInput = {
  actorId: string;
  action: string;
  entityType: "Patient" | "Screening" | "User";
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
};

const toJson = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

// Always called inside the same transaction as the change it records,
// so there is never a change without a log line (or a log line without a change).
export function writeAudit(tx: Tx, a: AuditInput) {
  return tx.auditLog.create({
    data: {
      actorId: a.actorId,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      oldValue: toJson(a.oldValue),
      newValue: toJson(a.newValue),
      reason: a.reason ?? null,
    },
  });
}
