/**
 * Display helpers shared by the laboratory UI and the portal. Pure and
 * dependency-free so both server pages and client components can use them.
 * Timestamps render on the clinic's wall clock via the shared clinical helper.
 */
export { fmtStamp } from "@/features/clinical/format";

const STATUS_LABELS: Record<string, string> = {
  ORDERED: "awaiting collection",
  COLLECTED: "in the lab",
  COMPLETED: "awaiting verification",
  VERIFIED: "verified",
  CANCELLED: "cancelled",
};

export function labStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export function labPriorityLabel(priority: string): string {
  return priority.replaceAll("_", " ").toLowerCase();
}

export function labSpecimenLabel(specimen: string): string {
  return specimen.replaceAll("_", " ").toLowerCase();
}

export function labFlagLabel(flag: string | null): string | null {
  return flag ? flag.replaceAll("_", " ").toLowerCase() : null;
}

/** `Out of range` flags are what a clinician scans for; normal needs no shout. */
export function labFlagTone(flag: string | null): "critical" | "attention" | "normal" {
  if (flag === "CRITICAL") return "critical";
  if (flag === "LOW" || flag === "HIGH") return "attention";
  return "normal";
}

export function labResultSummary(item: {
  testName: string;
  resultValue: string | null;
  unit?: string | null;
  flag?: string | null;
}): string {
  const value = item.resultValue === null ? "pending" : `${item.resultValue}${item.unit ? ` ${item.unit}` : ""}`;
  return `${item.testName}: ${value}`;
}

/** `2 of 3 reported` — how far along the bench is with this order. */
export function labProgress(items: Array<{ resultValue: string | null }>): string {
  const done = items.filter((item) => item.resultValue !== null).length;
  return `${done} of ${items.length} reported`;
}
