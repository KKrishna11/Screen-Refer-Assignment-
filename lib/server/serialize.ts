import type { Patient } from "@prisma/client";
import { toDateOnlyString } from "../age";

// DOB goes out as "YYYY-MM-DD" (a calendar date, not a moment in time) so the
// browser's timezone can never shift it by a day.
export function serializePatient(p: Patient) {
  return {
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    dob: toDateOnlyString(p.dob),
    sex: p.sex,
    village: p.village,
    createdById: p.createdById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  };
}
