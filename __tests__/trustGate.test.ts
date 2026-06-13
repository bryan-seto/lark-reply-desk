import { describe, it, expect } from "vitest";
import { trustGate } from "../lib/trustGate";

const TODAY = "2026-06-12";

const BASE_ROW = {
  status: "pending" as const,
  draft_text: "hi pak @Alex Johnson, circling back ya 🙏",
  suggested_date: "2026-06-12",
  followup_basis: "they_owe_reply",
  is_monitoring: false,
  pending_fix: false,
  last_from: "Alex Johnson",
  validation: { ok: true, failures: [], scrubbed: "hi pak @Alex Johnson, circling back ya 🙏" },
};

describe("trustGate", () => {
  it("passes a fully valid row", () => {
    const result = trustGate(BASE_ROW, TODAY);
    expect(result.sendable).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects non-pending status", () => {
    const result = trustGate({ ...BASE_ROW, status: "sent" }, TODAY);
    expect(result.sendable).toBe(false);
    expect(result.reasons.some((r) => r.includes("not pending"))).toBe(true);
  });

  it("rejects empty draft", () => {
    const result = trustGate({ ...BASE_ROW, draft_text: "" }, TODAY);
    expect(result.sendable).toBe(false);
    expect(result.reasons.some((r) => r.includes("no draft"))).toBe(true);
  });

  it("rejects future suggested_date", () => {
    const result = trustGate({ ...BASE_ROW, suggested_date: "2026-06-16" }, TODAY);
    expect(result.sendable).toBe(false);
    expect(result.reasons.some((r) => r.includes("not due until"))).toBe(true);
  });

  it("rejects closed basis", () => {
    const result = trustGate({ ...BASE_ROW, followup_basis: "closed" }, TODAY);
    expect(result.sendable).toBe(false);
  });

  it("rejects monitoring rows", () => {
    const result = trustGate({ ...BASE_ROW, is_monitoring: true }, TODAY);
    expect(result.sendable).toBe(false);
    expect(result.reasons.some((r) => r.includes("monitoring"))).toBe(true);
  });

  it("rejects rows with failed validation", () => {
    const result = trustGate({
      ...BASE_ROW,
      validation: { ok: false, failures: ["honorific: ka @Alex Johnson — roster says pak"] },
    }, TODAY);
    expect(result.sendable).toBe(false);
    expect(result.reasons.some((r) => r.includes("honorific"))).toBe(true);
  });

  it("rejects user-replied-last rows (not pending_fix)", () => {
    const result = trustGate({ ...BASE_ROW, last_from: "You", pending_fix: false }, TODAY);
    expect(result.sendable).toBe(false);
    expect(result.reasons.some((r) => r.includes("you replied last"))).toBe(true);
  });

  it("allows user-replied-last when pending_fix=true", () => {
    const result = trustGate({ ...BASE_ROW, last_from: "You", pending_fix: true }, TODAY);
    // Should NOT have the 'you replied last' reason
    expect(result.reasons.every((r) => !r.includes("you replied last"))).toBe(true);
  });
});
