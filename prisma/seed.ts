// npm run db:seed — creates the test logins and a few sample patients.
// Safe to run more than once (users are upserted; sample patients are only added once).

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { nameKey } from "../lib/names";
import { parseDateOnly } from "../lib/age";

const prisma = new PrismaClient();

const users = [
  { username: "worker1", name: "Asha Patil (Health worker)", role: "WORKER" as const, password: process.env.SEED_WORKER_PASSWORD || "Worker@123" },
  { username: "worker2", name: "Ravi Kumar (Health worker)", role: "WORKER" as const, password: process.env.SEED_WORKER_PASSWORD || "Worker@123" },
  { username: "doctor", name: "Dr. Meera Shah", role: "DOCTOR" as const, password: process.env.SEED_DOCTOR_PASSWORD || "Doctor@123" },
];

async function main() {
  const created: Record<string, string> = {};
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const row = await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, role: u.role, passwordHash },
      create: { username: u.username, name: u.name, role: u.role, passwordHash },
    });
    created[u.username] = row.id;
  }

  const existing = await prisma.patient.count();
  if (existing === 0) {
    const samples = [
      { fullName: "सुनीता देवी", phone: "9876543210", dob: "1988-04-12", sex: "FEMALE" as const, village: "Shirur", by: "worker1" },
      { fullName: "Ramesh Jadhav", phone: "9123456780", dob: "1961-11-02", sex: "MALE" as const, village: "Shirur", by: "worker1" },
      { fullName: "Priya Kale", phone: "9988776655", dob: "2020-06-20", sex: "FEMALE" as const, village: "Khed", by: "worker1" },
      { fullName: "Mohan Lal", phone: "9812345670", dob: "1975-01-15", sex: "MALE" as const, village: "Baramati", by: "worker2" },
    ];
    for (const s of samples) {
      await prisma.patient.create({
        data: {
          fullName: s.fullName,
          nameKey: nameKey(s.fullName),
          phone: s.phone,
          dob: parseDateOnly(s.dob)!,
          sex: s.sex,
          village: s.village,
          createdById: created[s.by],
        },
      });
    }
  }
  console.log("Seeded users:", users.map((u) => `${u.username} / ${u.password}`).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
