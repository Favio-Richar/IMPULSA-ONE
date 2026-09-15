import { apiFetch } from "../api-client";

export interface CurrentUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
}

export function getMe(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>("/auth/me");
}

export function login(email: string, password: string): Promise<{ user: { id: string; email: string } }> {
  return apiFetch("/auth/login", { method: "POST", body: { email, password } });
}

export function register(email: string, password: string): Promise<{ userId: string }> {
  return apiFetch("/auth/register", { method: "POST", body: { email, password } });
}

export function verifyEmail(token: string): Promise<void> {
  return apiFetch("/auth/verify-email", { method: "POST", body: { token } });
}

export function logout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST" });
}
