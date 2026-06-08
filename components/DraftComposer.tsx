"use client";

import { useEffect, useRef, useState } from "react";

type RefineSource = { type: string; name: string; quote: string };

interface DraftComposerProps {
  /** handle of the currently-selected followup row (null = nothing selected) */
  fuHandle: string | null;
  /** draft text from the selected row; changes whenever fuHandle changes */
  initialDraft: string;
  /** when true, the flagged fix is still unresolved — show a nudge placeholder */
  pendingFix?: boolean;
  /** called after a successful send — root removes the row and advances */
  onSent: (handle: string) => void;
  /** called whenever the composer wants to show a toast notification */
  onToast: (msg: string) => void;
}

export default function DraftComposer({
  fuHandle,
  initialDraft,
  pendingFix,
  onSent,
  onToast,
}: DraftComposerProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [base, setBase] = useState(initialDraft);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // refine-with-context state
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstr, setRefineInstr] = useState("");
  const [useObsidian, setUseObsidian] = useState(true);
  const [useMemory, setUseMemory] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineStatus, setRefineStatus] = useState("");
  const [refineSources, setRefineSources] = useState<RefineSource[]>([]);

  // Reset draft + refine panel whenever the selected row changes (incl. → null)
  useEffect(() => {
    setDraft(initialDraft);
    setBase(initialDraft);
    setRefineOpen(false);
    setRefineInstr("");
    setRefineStatus("");
    setRefineSources([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuHandle]); // intentionally NOT in initialDraft — fuHandle is the stable trigger

  // Textarea auto-resize
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [draft, fuHandle]);

  // Cmd/Ctrl+Enter keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void send();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuHandle, draft, sending]);

  async function send() {
    if (sending || !fuHandle) return;
    const activeHandle = fuHandle;
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: activeHandle, sent_text: draft, queue: "followup" }),
      });
      const r = await res.json();
      if (r.status === "sent") onToast("Sent · flag kept");
      else if (r.status === "queued") onToast("Queued · sends on the daemon's next cycle");
      else {
        onToast(`Send failed: ${r.detail || "unknown"}`);
        setSending(false);
        return;
      }
      onSent(activeHandle);
    } catch {
      onToast("Send failed: network");
    } finally {
      setSending(false);
    }
  }

  async function runRefine() {
    if (refining || !fuHandle) return;
    setRefining(true);
    setRefineSources([]);
    setRefineStatus("reading your notes + memory…");
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: fuHandle,
          prior_draft: draft,
          instruction: refineInstr,
          useObsidian,
          useMemory,
        }),
      });
      const r = await res.json();
      if (r.ok && r.draft) {
        setDraft(r.draft);
        setRefineSources(r.sources || []);
        setRefineStatus(r.status || "re-drafted with your context");
      } else if (r.ok && !r.draft) {
        setRefineSources(r.sources || []);
        setRefineStatus(r.status || "no change suggested");
      } else {
        setRefineStatus(`couldn't refine: ${r.error || "unknown"}`);
      }
    } catch {
      setRefineStatus("couldn't refine: network error");
    } finally {
      setRefining(false);
    }
  }

  const edited = draft.trim() !== base.trim();

  return (
    <div className="border-t border-border bg-background px-[26px] pb-[18px] pt-4">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-2 flex items-center gap-2 text-[11.5px] text-[var(--muted-foreground)]">
          <span className="text-[var(--primary)]">✦</span>
          Suggested follow-up
          <b className="font-semibold text-foreground">· drafted in your style</b>
        </div>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          placeholder={
            !base
              ? pendingFix
                ? "fix still pending · draft your nudge here"
                : "looks handled · edit here if you still want to nudge"
              : undefined
          }
          className="w-full resize-none rounded-lg border border-border bg-background px-3.5 py-3 text-[14px] leading-[1.55] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)]"
          style={{ minHeight: 80 }}
        />

        {/* refine with my context */}
        <div className="mt-2.5 overflow-hidden rounded-[10px] border border-border bg-[var(--card)]">
          <button
            onClick={() => setRefineOpen((o) => !o)}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--hover)]"
          >
            <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[var(--accent)] text-[13px] text-[var(--accent-foreground)]">
              ⌕
            </span>
            <span className="flex-1">
              <span className="block text-[13px] font-semibold">Refine with my context</span>
              <span className="block text-[11.5px] text-[var(--muted-foreground)]">
                let Hermes read my Obsidian notes + memory before re-drafting
              </span>
            </span>
            <span
              className="text-[var(--faint)] transition-transform"
              style={{ transform: refineOpen ? "rotate(180deg)" : "none" }}
            >
              ▾
            </span>
          </button>
          {refineOpen && (
            <div className="border-t border-border px-3 pb-3 pt-2.5">
              <input
                value={refineInstr}
                onChange={(e) => setRefineInstr(e.target.value)}
                placeholder="optional: what should I check? e.g. 'read my PRD on the airline filter'"
                className="mb-2.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)]"
              />
              <div className="mb-1.5 text-[11px] text-[var(--faint)]">Sources Hermes may read</div>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setUseObsidian((v) => !v)}
                  aria-pressed={useObsidian}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] " +
                    (useObsidian
                      ? "border-transparent bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : "border-border bg-background text-[var(--muted-foreground)]")
                  }
                >
                  📄 Obsidian notes
                </button>
                <button
                  onClick={() => setUseMemory((v) => !v)}
                  aria-pressed={useMemory}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] " +
                    (useMemory
                      ? "border-transparent bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : "border-border bg-background text-[var(--muted-foreground)]")
                  }
                >
                  🧠 My memory
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={runRefine}
                  disabled={refining || (!useObsidian && !useMemory)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-[13px] font-semibold text-[var(--primary-foreground)] transition hover:brightness-110 disabled:opacity-50"
                >
                  {refining ? "Reading…" : "⌕ Re-draft with context"}
                </button>
                {refineStatus && (
                  <span className="text-[11.5px] text-[var(--faint)]">{refineStatus}</span>
                )}
              </div>
              {refineSources.length > 0 && (
                <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--good,#0f9d6b)]">
                    ✓ Read {refineSources.length} source{refineSources.length > 1 ? "s" : ""}
                  </div>
                  {refineSources.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 py-0.5 text-[12px] text-[var(--muted-foreground)]">
                      <span className="flex-none">{s.type === "memory" ? "🧠" : "📄"}</span>
                      <span>
                        <span className="font-semibold text-foreground">{s.name}</span>
                        {s.quote && (
                          <span className="mt-0.5 block text-[11.5px] italic text-[var(--faint)]">
                            {s.quote}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={send}
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-[13.5px] font-semibold text-[var(--primary-foreground)] transition hover:brightness-110 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send follow-up"}
            <span className="rounded border border-white/40 px-1 text-[11px] opacity-80">⌘↵</span>
          </button>
          <span
            className="ml-auto text-[11.5px] transition-colors"
            style={{ color: edited ? "var(--edited)" : "var(--faint)" }}
          >
            {edited ? "edited — saved as your style signal" : "matches your style"}
          </span>
        </div>
      </div>
    </div>
  );
}
