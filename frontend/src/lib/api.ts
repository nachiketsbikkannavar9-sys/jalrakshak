const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:4000" : "");

export const API_BASE = BASE;
export const TOKEN_KEY = "jalrakshak_auth";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getAuthUser(): {
  id: string;
  email: string;
  role: string;
  displayName: string;
  jurisdictionRegions: string[];
  jurisdictionStationIds: string[];
} | null {
  try {
    return JSON.parse(localStorage.getItem("jalrakshak_user") ?? "null");
  } catch {
    return null;
  }
}
export function setAuthUser(user: unknown) {
  if (user) localStorage.setItem("jalrakshak_user", JSON.stringify(user));
  else localStorage.removeItem("jalrakshak_user");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });