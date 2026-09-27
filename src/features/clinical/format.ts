/**
 * Display helpers shared by the clinical UI and the portal. Pure and
 * dependency-free so both server pages and client components can use them.
 */
import { formatZoned } from "@/lib/timezone";

export type VitalsLike = {
  recordedAt: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  spo2: number | null;
  weightKg: number | null;
  heightCm: number | null;
};

/** `YYYY-MM-DD HH:MM (Zone)` — clinical times read on the clinic's clock. */
export function fmtStamp(iso: string, timeZone: string): string {
  return `${formatZoned(new Date(iso), timeZone)} (${timeZone})`;
}

export function kindLabel(kind: string): string {
  return kind.replaceAll("_", " ").toLowerCase();
}

/** One-line observation summary, skipping anything not measured. */
export function vitalsSummary(v: VitalsLike): string {
  const parts: string[] = [];
  if (v.systolic !== null && v.diastolic !== null) parts.push(`BP ${v.systolic}/${v.diastolic} mmHg`);
  else if (v.systolic !== null) parts.push(`SBP ${v.systolic} mmHg`);
  if (v.pulse !== null) parts.push(`pulse ${v.pulse} bpm`);
  if (v.temperature !== null) parts.push(`temp ${v.temperature} °C`);
  if (v.spo2 !== null) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.weightKg !== null) parts.push(`${v.weightKg} kg`);
  if (v.heightCm !== null) parts.push(`${v.heightCm} cm`);
  return parts.length > 0 ? parts.join(" · ") : "No measurements";
}
