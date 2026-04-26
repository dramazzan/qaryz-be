import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function absoluteUrl(path: string) {
  const base = process.env.AUTH_URL ?? "https://qaryz-fe.vercel.app";
  return new URL(path, base).toString();
}

export function createInviteCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}
