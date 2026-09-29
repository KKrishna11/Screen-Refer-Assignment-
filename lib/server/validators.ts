import { z } from "zod";
import { cleanName, validateName } from "../names";
import { normalizePhone } from "../phone";
import { parseDateOnly, validateDob } from "../age";

const name = z.string().transform((v, ctx) => {
  const n = cleanName(v);
  const err = validateName(n);
  if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  return n;
});

const phone = z.string().transform((v, ctx) => {
  const r = normalizePhone(v);
  if (!r.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
    return "";
  }
  return r.phone;
});

const dob = z.string().transform((v, ctx) => {
  const d = parseDateOnly(v);
  const err = d ? validateDob(d) : "Use the format YYYY-MM-DD";
  if (err || !d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err ?? "Invalid date" });
    return new Date(0);
  }
  return d;
});

const village = z
  .string()
  .max(160)
  .transform((v) => cleanName(v) || null)
  .nullable()
  .optional();

export const PatientCreate = z.object({
  fullName: name,
  phone,
  dob,
  sex: z.enum(["MALE", "FEMALE", "OTHER"]),
  village,
  // set when the worker has seen the "possible duplicate" warning and says it's a different person
  confirmNotDuplicate: z.boolean().optional(),
});

export const PatientUpdate = PatientCreate.partial().extend({
  // why the record is being changed — optional, stored in the audit log
  changeReason: z.string().max(500).optional(),
});

export const ScreeningCreate = z.object({
  clientId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  patientId: z.string().min(1).max(32),
  answers: z.record(z.string(), z.unknown()),
});

export const ReviewInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), note: z.string().max(1000).optional() }),
  z.object({
    action: z.literal("override"),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    reason: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(10, "Give a reason of at least 10 characters").max(1000)),
  }),
]);
