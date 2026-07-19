export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("vigie_api_key") ?? "";
}

export function setApiKey(key: string): void {
  window.localStorage.setItem("vigie_api_key", key);
}

export async function api<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": getApiKey(),
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error((json as { erreur?: string }).erreur ?? `Erreur ${res.status}`);
  }
  return json as T;
}
