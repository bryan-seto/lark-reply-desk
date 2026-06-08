/**
 * TDD red-bar tests for DraftComposer pendingFix prop.
 *
 * These tests are written AGAINST THE APPROVED FIX (not yet implemented).
 * They are expected to FAIL until DraftComposer gains pendingFix prop support.
 *
 * Bug: DraftComposer shows 'looks handled — edit here if you still want to nudge'
 * (with em dash) even when pendingFix=true. After the fix:
 *   - pendingFix=true  + initialDraft='' => 'fix still pending · draft your nudge here'
 *   - pendingFix=false + initialDraft='' => 'looks handled · edit here if you still want to nudge'
 *                                           (· not —)
 *   - non-empty initialDraft              => no placeholder regardless of pendingFix
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DraftComposer from "../components/DraftComposer";

// Mock fetch globally — DraftComposer calls /api/send and /api/refine
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    json: async () => ({ status: "sent" }),
    ok: true,
  });
});

describe("DraftComposer – pendingFix placeholder behaviour", () => {
  // ---------------------------------------------------------------------------
  // CRITERION 3
  // ---------------------------------------------------------------------------
  it("shows 'fix still pending · draft your nudge here' when pendingFix=true and initialDraft is empty", () => {
    /**
     * Fails because:
     * 1. DraftComposer does not accept a pendingFix prop (TypeScript error + prop ignored).
     * 2. Even if we pass it, the current placeholder is the hard-coded em-dash version.
     *
     * After the fix: pendingFix=true forces the '·' nudge placeholder.
     */
    render(
      <DraftComposer
        fuHandle="fu-123"
        initialDraft=""
        onSent={vi.fn()}
        onToast={vi.fn()}
        // @ts-expect-error pendingFix not yet in DraftComposerProps
        pendingFix={true}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(textarea.placeholder).toBe(
      "fix still pending · draft your nudge here"
    );
  });

  // ---------------------------------------------------------------------------
  // CRITERION 4
  // ---------------------------------------------------------------------------
  it("shows 'looks handled · edit here if you still want to nudge' (· not —) when pendingFix=false and initialDraft is empty", () => {
    /**
     * Fails because the current placeholder uses an em dash (—), not the
     * middle dot (·) required by the approved fix.
     *
     * Current code (line 146 of DraftComposer.tsx):
     *   placeholder={!base ? "looks handled — edit here if you still want to nudge" : undefined}
     *
     * After the fix the separator is changed to ·:
     *   "looks handled · edit here if you still want to nudge"
     */
    render(
      <DraftComposer
        fuHandle="fu-456"
        initialDraft=""
        onSent={vi.fn()}
        onToast={vi.fn()}
        // @ts-expect-error pendingFix not yet in DraftComposerProps
        pendingFix={false}
      />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    // The CURRENT placeholder (em dash) must NOT be present
    expect(textarea.placeholder).not.toBe(
      "looks handled — edit here if you still want to nudge"
    );
    // The FIXED placeholder (middle dot) must be present
    expect(textarea.placeholder).toBe(
      "looks handled · edit here if you still want to nudge"
    );
  });

  // ---------------------------------------------------------------------------
  // CRITERION 5
  // ---------------------------------------------------------------------------
  it("renders no placeholder when initialDraft is non-empty, regardless of pendingFix", () => {
    /**
     * This test exercises both pendingFix=true and pendingFix=false with a
     * non-empty initialDraft. The placeholder must be absent in both cases.
     *
     * Partial failure expected: DraftComposer doesn't accept pendingFix prop
     * (ts-expect-error suppresses TS, but the behaviour for non-empty draft
     * currently shows undefined placeholder anyway — this test may already pass
     * the placeholder=undefined assertion, but it still fails because of the
     * TypeScript prop signature mismatch flagged by the ts-expect-error).
     *
     * After the fix: pendingFix prop exists and placeholder is only shown when
     * initialDraft is empty, so this passes cleanly.
     */
    const { rerender } = render(
      <DraftComposer
        fuHandle="fu-789"
        initialDraft="circling back on this ya 🙏"
        onSent={vi.fn()}
        onToast={vi.fn()}
        // @ts-expect-error pendingFix not yet in DraftComposerProps
        pendingFix={true}
      />
    );

    let textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(textarea.placeholder).toBeFalsy();

    // Also check pendingFix=false with non-empty draft
    rerender(
      <DraftComposer
        fuHandle="fu-789"
        initialDraft="circling back on this ya 🙏"
        onSent={vi.fn()}
        onToast={vi.fn()}
        // @ts-expect-error pendingFix not yet in DraftComposerProps
        pendingFix={false}
      />
    );
    textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(textarea.placeholder).toBeFalsy();
  });
});
