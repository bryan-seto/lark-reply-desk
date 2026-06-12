"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { trustGate, type TrustGateResult } from "@/lib/trustGate";

type FollowupRow = {
  handle: string;
  person: string;
  chat_name: string;
  draft_text: string;
  suggested_date?: string;
  status?: string;
  followup_basis?: string;
  is_monitoring?: boolean;
  pending_fix?: boolean;
  last_from?: string;
  validation?: { ok: boolean; failures: string[]; scrubbed: string };
};

type RowWithGate = FollowupRow & { gate: TrustGateResult; editedDraft: string };

interface Props {
  rows: FollowupRow[];
  onClose: () => void;
  onSent: (results: { sent: number; skipped: number }) => void;
}

export default function FollowUpAllModal({ rows, onClose, onSent }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [editMap, setEditMap] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [batchResult, setBatchResult] = useState<{sent:number;skipped:number}|null>(null);

  const gated = useMemo<RowWithGate[]>(
    () =>
      rows.map((r) => ({
        ...r,
        gate: trustGate(r, today),
        editedDraft: editMap[r.handle] ?? r.validation?.scrubbed ?? r.draft_text ?? "",
      })),
    [rows, today, editMap]
  );

  const sendable = gated.filter((r) => r.gate.sendable);
  const excluded = gated.filter((r) => !r.gate.sendable);

  // Default all sendable rows to checked
  useEffect(() => {
    const init: Record<string, boolean> = {};
    sendable.forEach((r) => { init[r.handle] = true; });
    setChecked(init);
  }, [sendable.length]); // only on initial mount / count change

  const checkedCount = Object.values(checked).filter(Boolean).length;

  async function handleSend() {
    setSending(true);
    const toSend = sendable.filter((r) => checked[r.handle]);
    const batchId = `fua_${Date.now()}`;
    let sent = 0, skipped = 0;
    // Send sequentially with small delay to avoid hammering Lark
    for (const row of toSend) {
      const draft = editMap[row.handle] ?? row.validation?.scrubbed ?? row.draft_text ?? "";
      try {
        const res = await fetch("/api/followup-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: row.handle, draft_text: draft, batch_id: batchId }),
        });
        const data = await res.json();
        if (data.status === "queued" || data.status === "sent") sent++;
        else skipped++;
      } catch {
        skipped++;
      }
      // Small delay between sends
      await new Promise((r) => setTimeout(r, 300));
    }
    setBatchResult({ sent, skipped });
    setSending(false);
    setTimeout(() => {
      onSent({ sent, skipped });
      onClose();
    }, 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Follow Up All"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-[var(--text)] text-base">
              ⚡ Follow Up All
            </h2>
            <p className="text-xs text-[var(--faint)] mt-0.5">
              Review drafts before sending. Excluded rows shown below.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--faint)] hover:text-[var(--text)] text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
          {batchResult ? (
            <div className="text-center py-8">
              <div className="text-2xl mb-2">✅</div>
              <div className="text-[var(--text)] font-medium">
                {batchResult.sent} sent · {batchResult.skipped} skipped
              </div>
            </div>
          ) : (
            <>
              {/* WILL SEND */}
              {sendable.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[var(--primary)] uppercase tracking-wide mb-2">
                    Will send ({checkedCount} / {sendable.length})
                  </h3>
                  <div className="space-y-3">
                    {sendable.map((row) => (
                      <div
                        key={row.handle}
                        className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg)] space-y-2"
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={checked[row.handle] ?? true}
                            onChange={(e) =>
                              setChecked((prev) => ({ ...prev, [row.handle]: e.target.checked }))
                            }
                            className="mt-0.5 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-[var(--text)] text-sm">
                                {row.person}
                              </span>
                              <span className="text-xs text-[var(--faint)] truncate">
                                · {row.chat_name}
                              </span>
                              {row.pending_fix && (
                                <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 rounded">⏳ fix pending</span>
                              )}
                            </div>
                            <textarea
                              className="mt-1.5 w-full text-xs font-mono bg-[var(--card)] border border-[var(--border)] rounded p-2 text-[var(--text)] resize-y min-h-[60px] focus:outline-none focus:border-[var(--primary)]"
                              value={editMap[row.handle] ?? row.validation?.scrubbed ?? row.draft_text}
                              onChange={(e) =>
                                setEditMap((prev) => ({ ...prev, [row.handle]: e.target.value }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* EXCLUDED */}
              {excluded.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wide mb-2">
                    Excluded ({excluded.length})
                  </h3>
                  <div className="space-y-1">
                    {excluded.map((row) => (
                      <div
                        key={row.handle}
                        className="flex items-start gap-2 text-xs text-[var(--faint)] py-1"
                      >
                        <span className="flex-shrink-0 font-medium text-[var(--text)]">
                          {row.person}
                        </span>
                        <span className="truncate">
                          · {row.gate.reasons.join(" · ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {sendable.length === 0 && (
                <div className="text-center py-8 text-[var(--faint)] text-sm">
                  No sendable drafts right now. All rows are either not due, excluded, or have draft issues.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!batchResult && (
          <div className="px-5 py-4 border-t border-[var(--border)] flex items-center justify-end gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="text-sm text-[var(--faint)] hover:text-[var(--text)] px-3 py-1.5 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || checkedCount === 0}
              className="text-sm bg-[var(--primary)] text-white px-4 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {sending ? "Sending…" : `Send ${checkedCount} follow-up${checkedCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
