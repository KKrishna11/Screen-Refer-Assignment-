"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./SessionProvider";
import { api } from "@/lib/client/api";
import { listDrafts } from "@/lib/client/drafts";

export function Nav() {
  const { me, online, queued, setMe } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/login") return null;

  async function logout() {
    if (me && listDrafts(me.id).some((d) => d.queued)) {
      if (!confirm("Some screenings have not been sent yet. They stay saved on this phone and will send after you log in again. Log out?")) return;
    }
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
    router.replace("/login");
  }

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/patients" className="brand">Screen &amp; Refer</Link>
          <Link href="/patients">Patients</Link>
          <Link href="/screenings">{me?.role === "DOCTOR" ? "Review queue" : "My screenings"}</Link>
          {me?.role === "DOCTOR" && <Link href="/audit">Change log</Link>}
          <button onClick={logout}>Log out</button>
          {me && (
            <span className="who">
              {me.name} · {me.role === "DOCTOR" ? "Doctor" : "Health worker"}
            </span>
          )}
        </div>
      </nav>
      {!online && (
        <div className="container" style={{ paddingBottom: 0 }}>
          <div className="notice">No internet connection. You can keep filling the screening form — answers are saved on this phone.</div>
        </div>
      )}
      {queued > 0 && (
        <div className="container" style={{ paddingBottom: 0 }}>
          <div className="notice">
            {queued} screening{queued > 1 ? "s" : ""} waiting to be sent. {online ? "Sending…" : "Will send automatically when the connection is back."}
          </div>
        </div>
      )}
    </>
  );
}
