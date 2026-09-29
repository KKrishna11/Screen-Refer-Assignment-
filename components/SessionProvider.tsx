"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { listDrafts, submitDraft } from "@/lib/client/drafts";

export type Me = { id: string; name: string; username: string; role: "WORKER" | "DOCTOR" };
type Ctx = { me: Me | null; online: boolean; queued: number; refreshQueue: () => void; setMe: (m: Me | null) => void };

const SessionCtx = createContext<Ctx>({ me: null, online: true, queued: 0, refreshQueue: () => {}, setMe: () => {} });
export const useSession = () => useContext(SessionCtx);

const ME_KEY = "sr:me";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMeState] = useState<Me | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const syncing = useRef(false);

  const setMe = useCallback((m: Me | null) => {
    setMeState(m);
    try {
      if (m) localStorage.setItem(ME_KEY, JSON.stringify(m));
      else localStorage.removeItem(ME_KEY);
    } catch {}
  }, []);

  // Send any screenings that were submitted while offline.
  const refreshQueue = useCallback(async () => {
    if (!me || syncing.current) return;
    const pending = listDrafts(me.id).filter((d) => d.queued);
    setQueued(pending.length);
    if (!pending.length || !navigator.onLine) return;
    syncing.current = true;
    try {
      for (const d of pending) {
        try {
          await submitDraft(me.id, d);
        } catch (e) {
          if (e instanceof ApiError && (e.offline || e.status === 401)) break; // try again later
        }
      }
    } finally {
      syncing.current = false;
      setQueued(listDrafts(me.id).filter((d) => d.queued).length);
    }
  }, [me]);

  useEffect(() => {
    // show the cached user instantly (works offline), then confirm with the server
    try {
      const cached = localStorage.getItem(ME_KEY);
      if (cached) setMeState(JSON.parse(cached));
    } catch {}
    setOnline(navigator.onLine);
    if (pathname === "/login") return;
    api<{ user: Me }>("/api/auth/me")
      .then((r) => setMe(r.user))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      refreshQueue();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    refreshQueue();
    const t = setInterval(refreshQueue, 20000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t);
    };
  }, [refreshQueue]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return <SessionCtx.Provider value={{ me, online, queued, refreshQueue, setMe }}>{children}</SessionCtx.Provider>;
}
