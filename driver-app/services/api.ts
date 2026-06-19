import { API_BASE_URL } from "../config/env";
import { getToken, clearToken } from "./auth";

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = await getToken();
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Token expired or invalid
    await clearToken();
    throw new Error("unauthorized");
  }

  return response;
}

export async function login(phone: string, password: string) {
  const res = await fetch(`${API_BASE_URL}/api/driver/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Login failed");
  }

  return data; // { token, customer_id, customer_name }
}

export async function pushLocation(ping: {
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  captured_at: string;
}) {
  const res = await fetchWithAuth("/api/driver/location", {
    method: "POST",
    body: JSON.stringify(ping),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to push location");
  }
}
