"use client";

import { useRouter } from "next/navigation";
import { PatientForm } from "@/components/PatientForm";

export default function NewPatientPage() {
  const router = useRouter();
  return (
    <>
      <h1>Register patient</h1>
      <PatientForm onSaved={(id) => router.replace(`/patients/${id}`)} />
    </>
  );
}
