"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

// fetch wrapper: JSON in/out, cookies included, and a network failure becomes
// ApiError(status 0) so callers can tell "no connection" apart from "server said no".
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
  } catch {
    throw new ApiError(0, "No connection — check the network and try again");
  }
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `Request failed (${res.status})`), data);
  return data as T;
}
