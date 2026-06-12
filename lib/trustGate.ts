// lib/trustGate.ts
// Deterministic trust gate for Follow Up All.
// Pure function — no I/O, no side effects.
// Python-side draft_validator.py is the source of truth for honorific/placeholder checks;
// we read its OUTPUT stored in row.validation rather than re-implementing the regex.

export interface TrustGateResult {
  sendable: boolean;
  reasons: string[];
}

export function trustGate(row: {
  status?: string;
  draft_text?: string;
  suggested_date?: string;
  followup_basis?: string;
  is_monitoring?: boolean;
  pending_fix?: boolean;
  last_from?: string;
  validation?: { ok: boolean; failures: string[] };
}, today: string): TrustGateResult {
  const reasons: string[] = [];

  if ((row.status ?? "pending") !== "pending") {
    reasons.push("not pending");
  }
  if (!row.draft_text?.trim()) {
    reasons.push("no draft");
  }
  const sugDate = row.suggested_date ?? "9999-12-31";
  if (sugDate > today) {
    reasons.push(`not due until ${sugDate}`);
  }
  if (row.followup_basis === "closed") {
    reasons.push("looks closed — no action needed");
  }
  if (row.is_monitoring) {
    reasons.push("monitoring row — check numbers yourself first");
  }
  if (row.validation && !row.validation.ok) {
    const failures = row.validation.failures ?? ["unvalidated"];
    reasons.push(...failures.map((f) => `draft issue: ${f}`));
  } else if (!row.validation) {
    // No validation record yet — treat as needs-review but don't block
    // (validation runs on next harvest cycle)
  }
  // Stale: Bryan replied last AND no pending fix = ball in their court
  if (row.last_from === "You" && !row.pending_fix) {
    reasons.push("you replied last — waiting on them");
  }

  return { sendable: reasons.length === 0, reasons };
}
