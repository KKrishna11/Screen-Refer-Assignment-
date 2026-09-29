"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { useSession, type Me } from "@/components/SessionProvider";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setMe } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: Me }>("/api/auth/login", { method: "POST", body: { username, password } });
      setMe(r.user);
      const next = params.get("next");
      // only allow same-site relative paths, never an external redirect
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/patients");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Screen &amp; Refer</h1>
      <p className="muted">Log in to continue</p>
      {params.get("next") && <div className="notice">Please log in again. Any screening answers you entered are still saved on this phone.</div>}
      <label className="field">
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
      </label>
      <label className="field">
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && <div className="notice error">{error}</div>}
      <button className="btn block" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
