"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ThreadMsg = { t: string; from: string; text: string; is_flagged?: boolean };
type RefineSource = { type: string; name: string; quote: string };
type FollowupRow = {
  handle: string;
  thread_id: string;
  chat_id: string;
  chat_name: string;
  person: string;
  parent_message_id: string;
  flag_message_id?: string;
  flagged_text?: string;
  flagged_from?: string;
  flagged_at: number;
  last_activity: string;
  last_activity_days: number;
  last_from: string;
  waiting_state: "waiting_on_them" | "they_replied";
  summary?: string;
  about_subject?: string;
  about_owner?: string;
  next_action?: string;
  thread_incomplete?: boolean;
  suggested_date?: string;
  suggested_label?: string;
  suggested_reason?: string;
  suggested_days_out?: number;
  suggested_from_commitment?: boolean;
  timing_quote?: string;
  followup_basis?: string;
  is_monitoring?: boolean;
  pending_fix?: boolean;
  corrected?: boolean;
  corrected_at?: number;
  correction_note?: string;
  correction_stale?: boolean;
  thread_json: ThreadMsg[];
  draft_text: string;
  drafted_at: number;
  status: "pending" | "sent";
  sent_text?: string;
};

const BRYAN_TOKENS = ["Bryan Se To", "Bryan"];
const isBryan = (from: string) =>
  !!from && (from === "You" || BRYAN_TOKENS.some((tok) => from.includes(tok)));
const initials = (n: string) =>
  (n || "?")
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const COLORS = ["#2383e2", "#0f9d6b", "#cb912f", "#9333ea", "#0ea5e9", "#e0517a"];
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
};
const ageLabel = (d: number) => (d <= 0 ? "today" : `${d}d`);
const isRawId = (s?: string) => !!s && /^(oc_|om_|omt_)/.test(s);
const prettyChat = (s?: string) => (!s || isRawId(s) ? "" : s);

// Urgency = WHEN Bryan must act, derived from the suggested follow-up date
// (suggested_days_out), NOT when the message was last sent. Lower rank = sooner.
type Urgency = { rank: number; label: string; key: string };
const urgencyOf = (r: FollowupRow): Urgency => {
  const d = r.suggested_days_out ?? 99;
  if (d < 0) return { rank: 0, label: "Overdue", key: "overdue" };
  if (d === 0) return { rank: 1, label: "Today", key: "today" };
  if (d === 1) return { rank: 2, label: "Tomorrow", key: "tomorrow" };
  if (d <= 7) return { rank: 3, label: "This week", key: "week" };
  return { rank: 4, label: "Later", key: "later" };
};
const URGENCY_COLOR: Record<string, string> = {
  overdue: "var(--edited)",
  today: "var(--primary)",
  tomorrow: "#cb912f",
  week: "#0f9d6b",
  later: "var(--faint)",
};
// Sort by action-required date: urgency bucket, then exact days_out, then how
// long it's been waiting (older waits break ties first).
const sortFu = (rows: FollowupRow[]) =>
  [...rows].sort(
    (a, b) =>
      urgencyOf(a).rank - urgencyOf(b).rank ||
      (a.suggested_days_out ?? 99) - (b.suggested_days_out ?? 99) ||
      (b.last_activity_days ?? 0) - (a.last_activity_days ?? 0)
  );
const actionLine = (r: FollowupRow) =>
  r.thread_incomplete
    ? "⚠ thread incomplete — re-harvest"
    : r.next_action ||
      (r.waiting_state === "waiting_on_them"
        ? `Nudge ${r.person}`
        : `${r.last_from} replied — a short reply closes this`);

export default function Home() {
  const [fuRows, setFuRows] = useState<FollowupRow[]>([]);
  const [fuHandle, setFuHandle] = useState<string | null>(null);
  const fuHandleRef = useRef<string | null>(null);
  useEffect(() => {
    fuHandleRef.current = fuHandle;
  }, [fuHandle]);
  const [threadOpen, setThreadOpen] = useState(false);

  // composer
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // refine-with-context
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstr, setRefineInstr] = useState("");
  const [useObsidian, setUseObsidian] = useState(true);
  const [useMemory, setUseMemory] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineStatus, setRefineStatus] = useState("");
  const [refineSources, setRefineSources] = useState<RefineSource[]>([]);

  // unflag + link-to-related-chat (Plan A)
  const [unflagOpen, setUnflagOpen] = useState(false);
  const [unflagNote, setUnflagNote] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<{ chat_id: string; name: string }[]>([]);
  const [linkedChat, setLinkedChat] = useState<{ chat_id: string; chat_name: string } | null>(null);
  const [unflagging, setUnflagging] = useState(false);

  // inline correction + teach-the-model (Plan B)
  const [fixOpen, setFixOpen] = useState(false);
  const [fixDate, setFixDate] = useState("");
  const [fixPerson, setFixPerson] = useState("");
  const [fixNl, setFixNl] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixStatus, setFixStatus] = useState("");
  const [fixLearned, setFixLearned] = useState("");

  const sorted = useMemo(() => sortFu(fuRows), [fuRows]);
  const fuCur = fuRows.find((r) => r.handle === fuHandle) || null;
  const edited = draft.trim() !== base.trim();

  const loadFu = useCallback(async (keep?: string | null) => {
    try {
      const res = await fetch(`/api/followups?status=pending`, { cache: "no-store" });
      const data: FollowupRow[] = await res.json();
      setFuRows((prev) =>
        JSON.stringify(prev) === JSON.stringify(data) ? prev : data
      );
      const stillThere = keep && data.some((r) => r.handle === keep);
      if (stillThere) return; // preserve selection + open draft
      const top = sortFu(data)[0];
      if (top) openFu(top);
      else {
        setFuHandle(null);
        setDraft("");
        setBase("");
      }
    } catch {
      setFuRows([]);
    }
  }, []);

  function openFu(r: FollowupRow) {
    setFuHandle(r.handle);
    setDraft(r.draft_text || "");
    setBase(r.draft_text || "");
    setThreadOpen(false);
    setRefineOpen(false);
    setRefineInstr("");
    setRefineStatus("");
    setRefineSources([]);
    // reset unflag popover
    setUnflagOpen(false);
    setUnflagNote("");
    setLinkQuery("");
    setLinkResults([]);
    setLinkedChat(null);
    // reset correction panel
    setFixOpen(false);
    setFixDate(r.suggested_date || "");
    setFixPerson(r.person || "");
    setFixNl("");
    setFixStatus("");
    setFixLearned("");
  }

  async function runRefine() {
    if (refining || !fuCur) return;
    setRefining(true);
    setRefineSources([]);
    setRefineStatus("reading your notes + memory…");
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: fuCur.handle,
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

  // initial load + light polling (preserves selection via ref)
  useEffect(() => {
    loadFu(fuHandleRef.current);
    const iv = setInterval(() => loadFu(fuHandleRef.current), 15000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounced related-chat search for the unflag link picker
  useEffect(() => {
    if (!unflagOpen) return;
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/followups/related?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        setLinkResults(Array.isArray(data) ? data : []);
      } catch {
        setLinkResults([]);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [linkQuery, unflagOpen]);

  // remove the current row from the rail + advance to next (shared by send + unflag)
  function dropCurrentRow(handle: string) {
    const remaining = fuRows.filter((x) => x.handle !== handle);
    setFuRows(remaining);
    const top = sortFu(remaining)[0];
    if (top) openFu(top);
    else {
      setFuHandle(null);
      setDraft("");
      setBase("");
    }
    setTimeout(() => loadFu(null), 1500);
  }

  async function doUnflag() {
    if (unflagging || !fuCur) return;
    const activeHandle = fuCur.handle;
    setUnflagging(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: activeHandle,
          action: "unflag",
          note: unflagNote,
          link: linkedChat,
        }),
      });
      const r = await res.json();
      if (r.status === "unflagged") {
        showToast(linkedChat ? "Unflagged · linked" : "Unflagged");
        setUnflagOpen(false);
        dropCurrentRow(activeHandle);
      } else if (r.status === "queued") {
        showToast("Queued — Lark will remove the flag within ~60s");
        setUnflagOpen(false);
        dropCurrentRow(activeHandle);   // remove from UI now; daemon handles Lark side
      } else {
        showToast(`Unflag failed: ${r.detail || "unknown"}`);
      }
    } catch {
      showToast("Unflag failed: network");
    } finally {
      setUnflagging(false);
    }
  }

  // apply a structured correction (quick chips / date / person), refresh in place
  async function doCorrect(set: Record<string, string>, label: string) {
    if (fixing || !fuCur) return;
    const activeHandle = fuCur.handle;
    setFixing(true);
    setFixStatus(`applying: ${label}…`);
    setFixLearned("");
    try {
      const res = await fetch("/api/followups/correct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: activeHandle, set }),
      });
      const r = await res.json();
      if (r.ok) {
        showToast("Fixed · Hermes will remember");
        setFixStatus("");
        await loadFu(activeHandle);
      } else {
        setFixStatus(`couldn't fix: ${r.error || "unknown"}`);
      }
    } catch {
      setFixStatus("couldn't fix: network error");
    } finally {
      setFixing(false);
    }
  }

  // free-text correction -> NL mode (one Claude turn distills fields + a lesson)
  async function doCorrectNL() {
    if (fixing || !fuCur || !fixNl.trim()) return;
    const activeHandle = fuCur.handle;
    setFixing(true);
    setFixStatus("Hermes is reading your correction…");
    setFixLearned("");
    try {
      const res = await fetch("/api/followups/correct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: activeHandle, nl: fixNl.trim() }),
      });
      const r = await res.json();
      if (r.ok) {
        showToast("Fixed · Hermes will remember");
        setFixStatus("");
        if (r.lesson) setFixLearned(String(r.lesson).replace(/^[-\s]+/, ""));
        setFixNl("");
        await loadFu(activeHandle);
      } else {
        setFixStatus(`couldn't fix: ${r.error || "unknown"}`);
      }
    } catch {
      setFixStatus("couldn't fix: network error");
    } finally {
      setFixing(false);
    }
  }

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lrd-theme", next ? "dark" : "light");
    } catch {}
  }

  function showToast(t: string) {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [draft, fuHandle]);

  async function send() {
    if (sending || !fuCur) return;
    const activeHandle = fuCur.handle;
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: activeHandle, sent_text: draft, queue: "followup" }),
      });
      const r = await res.json();
      if (r.status === "sent") showToast("Sent · flag kept");
      else if (r.status === "queued") showToast("Queued · sends on the daemon's next cycle");
      else {
        showToast(`Send failed: ${r.detail || "unknown"}`);
        setSending(false);
        return;
      }
      const remaining = fuRows.filter((x) => x.handle !== activeHandle);
      setFuRows(remaining);
      const top = sortFu(remaining)[0];
      if (top) openFu(top);
      else {
        setFuHandle(null);
        setDraft("");
        setBase("");
      }
      setTimeout(() => loadFu(null), 1500);
    } catch {
      showToast("Send failed: network");
    } finally {
      setSending(false);
    }
  }

  // keyboard nav over the sorted rail
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const i = sorted.findIndex((r) => r.handle === fuHandle);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const n = sorted[Math.min(sorted.length - 1, i + 1)];
        if (n) openFu(n);
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const p = sorted[Math.max(0, i - 1)];
        if (p) openFu(p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, fuHandle, draft, sending]);

  const headerSub = fuCur
    ? prettyChat(fuCur.chat_name)
      ? `${prettyChat(fuCur.chat_name)} · flagged`
      : "flagged"
    : "";

  // counts for the rail header (how many need action now)
  const dueNow = fuRows.filter((r) => (r.suggested_days_out ?? 99) <= 0).length;

  return (
    <>
      <div className="grid h-screen w-screen grid-cols-[380px_1fr] overflow-hidden">
        {/* LEFT RAIL — triage by action-required date */}
        <aside className="flex min-h-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
          <div className="flex items-center gap-2 border-b border-[var(--sidebar-border)] px-4 py-3">
            <span className="text-[15px] font-semibold">Flagged</span>
            <span className="rounded-full bg-[var(--hover)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted-foreground)]">
              {fuRows.length}
            </span>
            {dueNow > 0 && (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--primary)]">
                {dueNow} due now
              </span>
            )}
            <button
              onClick={toggleTheme}
              title="Toggle theme"
              className="ml-auto rounded-md p-1 text-[15px] leading-none text-[var(--faint)] hover:bg-[var(--hover)] hover:text-foreground"
            >
              ◐
            </button>
          </div>
          <div className="px-4 pb-1.5 pt-2 text-[11px] text-[var(--faint)]">
            sorted by when you need to act
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {sorted.length === 0 ? (
              <div className="px-3.5 py-10 text-center text-[13px] text-[var(--faint)]">
                No flagged threads. Refreshes in the background.
              </div>
            ) : (
              (() => {
                let lastBucket = "";
                return sorted.map((r) => {
                  const u = urgencyOf(r);
                  const showHeader = u.key !== lastBucket;
                  lastBucket = u.key;
                  const selected = r.handle === fuHandle;
                  return (
                    <div key={r.handle}>
                      {showHeader && (
                        <div className="mb-1 mt-3 flex items-center gap-1.5 px-2 first:mt-1">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: URGENCY_COLOR[u.key] }}
                          />
                          <span
                            className="text-[10.5px] font-bold uppercase tracking-wider"
                            style={{ color: URGENCY_COLOR[u.key] }}
                          >
                            {u.label}
                          </span>
                        </div>
                      )}
                      <button
                        onClick={() => openFu(r)}
                        aria-current={selected}
                        className={
                          "mb-px grid w-full gap-[2px] rounded-lg px-2.5 py-2 text-left transition-colors " +
                          (selected ? "bg-[var(--accent)]" : "hover:bg-[var(--hover)]")
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="grid h-[20px] w-[20px] flex-none place-items-center rounded-md text-[9px] font-semibold text-white"
                            style={{ background: colorFor(r.person) }}
                          >
                            {initials(r.person)}
                          </span>
                          <span className="truncate text-[13px] font-semibold">{r.person}</span>
                          {r.suggested_label && (
                            <span
                              className="ml-auto whitespace-nowrap text-[10.5px] font-semibold"
                              style={{ color: URGENCY_COLOR[u.key] }}
                            >
                              {r.suggested_label}
                            </span>
                          )}
                        </div>
                        <div className="truncate pl-[28px] text-[12.5px] font-medium">
                          {r.about_subject || r.summary || "Flagged thread"}
                        </div>
                        <div className="truncate pl-[28px] text-[11.5px] text-[var(--muted-foreground)]">
                          {actionLine(r)}
                        </div>
                      </button>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </aside>

        {/* RIGHT — full brief + thread + composer for the selected item */}
        <main className="flex min-h-0 flex-col">
          {fuCur ? (
            <>
              <div className="flex items-center gap-3 border-b border-border px-[26px] py-4">
                <span
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[12px] font-semibold text-white"
                  style={{ background: colorFor(fuCur.person) }}
                >
                  {initials(fuCur.person)}
                </span>
                <div>
                  <div className="text-[15px] font-semibold">{fuCur.person}</div>
                  <div className="text-[12px] text-[var(--muted-foreground)]">{headerSub}</div>
                </div>
                <span className="ml-auto text-[11.5px] text-[var(--faint)]">flag kept on send</span>
              </div>

              <div className="flex flex-1 flex-col overflow-y-auto px-[26px] pb-2.5 pt-6">
                <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col">
                  {/* BRIEF-FIRST card */}
                  <div className="mb-3 flex flex-col gap-2.5">
                    <div className="rounded-[12px] border border-border bg-[var(--card)] px-4 py-3.5">
                      <div className="mb-1 flex items-start gap-2">
                        <span className="mt-0.5 text-[14px] leading-none">🚩</span>
                        <h2 className="flex-1 text-[16px] font-semibold leading-snug">
                          {fuCur.about_subject || fuCur.summary
                            ? fuCur.about_subject || "Flagged follow-up"
                            : `Follow-up with ${fuCur.person}`}
                        </h2>
                        <button
                          onClick={() => {
                            setFixOpen((o) => !o);
                            setUnflagOpen(false);
                          }}
                          className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--primary)]"
                          title="Fix this — correct the status, date, or what-to-do (Hermes learns from it)"
                        >
                          ✎ Fix this
                        </button>
                        <button
                          onClick={() => {
                            setUnflagOpen((o) => !o);
                            setFixOpen(false);
                          }}
                          className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--edited)]"
                          title="Unflag — remove the Lark bookmark"
                        >
                          ⚑ Unflag
                        </button>
                      </div>

                      {/* state badges + corrected chip */}
                      {(fuCur.is_monitoring || fuCur.pending_fix || fuCur.corrected) && (
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 pl-[22px]">
                          {fuCur.is_monitoring && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--primary)]">
                              📈 monitoring
                            </span>
                          )}
                          {fuCur.pending_fix && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--edited)_15%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--edited)]">
                              ⏳ fix pending
                            </span>
                          )}
                          {fuCur.corrected && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-[var(--hover)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--muted-foreground)]"
                              title={fuCur.correction_note || "you corrected this — Hermes will keep it across re-harvests"}
                            >
                              ✓ you corrected this{fuCur.correction_stale ? " · thread changed since" : ""}
                            </span>
                          )}
                        </div>
                      )}

                      {fuCur.summary ? (
                        <p className="mb-2.5 text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
                          {fuCur.summary}
                        </p>
                      ) : fuCur.thread_incomplete ? (
                        <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] text-[var(--edited)]">
                          ⚠ thread incomplete — re-harvest to rebuild this brief
                        </p>
                      ) : (
                        <p className="mb-2.5 text-[12.5px] italic text-[var(--faint)]">
                          no summary yet — re-harvest to generate one
                        </p>
                      )}

                      {/* What to do */}
                      <div className="mb-3 flex items-start gap-2 rounded-[8px] bg-[var(--accent)] px-3 py-2">
                        <span className="mt-px text-[12px] leading-none text-[var(--accent-foreground)]">→</span>
                        <div className="text-[13px] font-medium leading-snug text-[var(--accent-foreground)]">
                          {fuCur.next_action
                            ? fuCur.next_action
                            : fuCur.waiting_state === "waiting_on_them"
                            ? `Nudge ${fuCur.person} — no reply for ${ageLabel(fuCur.last_activity_days)}.`
                            : `${fuCur.last_from} replied — a short reply closes this.`}
                        </div>
                      </div>

                      {/* When to follow up + why */}
                      {fuCur.suggested_label && (
                        <div
                          className={
                            "mb-3 flex items-start gap-2 rounded-[8px] border px-3 py-2 " +
                            (fuCur.suggested_from_commitment
                              ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                              : "border-border bg-[var(--card)]")
                          }
                        >
                          <span className="mt-px text-[12px] leading-none">⏰</span>
                          <div className="min-w-0 text-[12.5px] leading-snug">
                            <span className="font-semibold">Follow up: {fuCur.suggested_label}</span>
                            {fuCur.suggested_from_commitment && (
                              <span className="ml-1.5 rounded-full bg-[var(--primary)] px-1.5 py-px text-[9.5px] font-semibold text-[var(--primary-foreground)]">
                                from their msg
                              </span>
                            )}
                            {fuCur.suggested_reason && (
                              <div className="mt-0.5 text-[var(--muted-foreground)]">
                                {fuCur.suggested_reason}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* meta row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--faint)]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="grid h-4 w-4 flex-none place-items-center rounded text-[8px] font-semibold text-white"
                            style={{ background: colorFor(fuCur.person) }}
                          >
                            {initials(fuCur.person)}
                          </span>
                          {fuCur.person}
                        </span>
                        <span>·</span>
                        <span
                          style={{
                            color:
                              fuCur.waiting_state === "waiting_on_them" ? "var(--edited)" : undefined,
                          }}
                        >
                          {fuCur.waiting_state === "waiting_on_them"
                            ? `waiting ${ageLabel(fuCur.last_activity_days)}`
                            : `they replied · ${ageLabel(fuCur.last_activity_days)}`}
                        </span>
                        {fuCur.about_owner && fuCur.about_owner !== fuCur.person && (
                          <>
                            <span>·</span>
                            <span>
                              owner: <b className="font-semibold text-foreground">{fuCur.about_owner}</b>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Correction panel (✎ Fix this) — judgment-shaped chips + teach-Hermes free text */}
                  {fixOpen && (
                    <div className="mb-3 rounded-[12px] border border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_5%,transparent)] px-4 py-3.5">
                      <div className="mb-2 text-[12px] font-semibold text-[var(--primary)]">
                        Fix this follow-up
                      </div>
                      <div className="mb-1.5 text-[11px] text-[var(--faint)]">Quick fixes (one tap)</div>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          disabled={fixing}
                          onClick={() => doCorrect({ pending_fix: "1", waiting_state: "waiting_on_them" }, "still pending")}
                          className="rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] hover:border-[var(--edited)] hover:text-[var(--edited)] disabled:opacity-50"
                        >
                          ⏳ Still pending
                        </button>
                        <button
                          disabled={fixing}
                          onClick={() => doCorrect({ is_monitoring: "1" }, "it's a monitor")}
                          className="rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
                        >
                          📈 It&apos;s a monitor (due today)
                        </button>
                        <button
                          disabled={fixing}
                          onClick={() => doCorrect({ followup_basis: "closed" }, "resolved")}
                          className="rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] hover:border-[#0f9d6b] hover:text-[#0f9d6b] disabled:opacity-50"
                        >
                          ✅ Actually resolved
                        </button>
                      </div>

                      {/* wrong date / wrong person */}
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-[var(--faint)]">📅 Wrong date</span>
                        <input
                          type="date"
                          value={fixDate}
                          onChange={(e) => setFixDate(e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
                        />
                        <button
                          disabled={fixing || !fixDate}
                          onClick={() => doCorrect({ suggested_date: fixDate }, "date")}
                          className="rounded-md bg-[var(--hover)] px-2 py-1 text-[11.5px] font-medium hover:brightness-95 disabled:opacity-50"
                        >
                          set
                        </button>
                        <span className="ml-2 text-[11px] text-[var(--faint)]">👤 Person</span>
                        <input
                          value={fixPerson}
                          onChange={(e) => setFixPerson(e.target.value)}
                          className="w-28 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
                        />
                        <button
                          disabled={fixing || !fixPerson.trim()}
                          onClick={() => doCorrect({ person: fixPerson.trim() }, "person")}
                          className="rounded-md bg-[var(--hover)] px-2 py-1 text-[11.5px] font-medium hover:brightness-95 disabled:opacity-50"
                        >
                          set
                        </button>
                      </div>

                      {/* teach Hermes free text */}
                      <div className="mb-1.5 text-[11px] text-[var(--faint)]">
                        Tell Hermes what&apos;s wrong (it learns the rule for next time)
                      </div>
                      <textarea
                        value={fixNl}
                        onChange={(e) => setFixNl(e.target.value)}
                        placeholder="e.g. when someone says 'I'll handle it' but the bug isn't confirmed fixed, that's still pending, not resolved"
                        className="mb-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-snug outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)]"
                        style={{ minHeight: 56 }}
                      />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={doCorrectNL}
                          disabled={fixing || !fixNl.trim()}
                          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-[13px] font-semibold text-[var(--primary-foreground)] transition hover:brightness-110 disabled:opacity-50"
                        >
                          {fixing ? "Working…" : "✦ Fix & teach"}
                        </button>
                        {fixStatus && <span className="text-[11.5px] text-[var(--faint)]">{fixStatus}</span>}
                      </div>
                      {fixLearned && (
                        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-[#0f9d6b] bg-[color-mix(in_srgb,#0f9d6b_8%,transparent)] px-3 py-2 text-[12px] text-foreground">
                          <span className="mt-px flex-none">🧠</span>
                          <span>
                            <b className="font-semibold">Learned:</b> {fixLearned}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Unflag popover (⚑ Unflag) — quiet, deliberate, on-page */}
                  {unflagOpen && (
                    <div className="mb-3 rounded-[12px] border border-[var(--edited)] bg-[color-mix(in_srgb,var(--edited)_5%,transparent)] px-4 py-3.5">
                      <div className="mb-1 text-[12px] font-semibold text-[var(--edited)]">Unflag this thread</div>
                      <div className="mb-2.5 text-[11.5px] text-[var(--muted-foreground)]">
                        Removes the Lark bookmark. If you link a chat, it&apos;s saved as a cross-reference so you know where this moved.
                      </div>
                      <input
                        value={unflagNote}
                        onChange={(e) => setUnflagNote(e.target.value)}
                        placeholder="optional: why are you unflagging? (e.g. moved to the airline-filter group)"
                        className="mb-2.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-[var(--edited)]"
                      />
                      {linkedChat ? (
                        <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[12px] text-[var(--accent-foreground)]">
                          🔗 {linkedChat.chat_name}
                          <button
                            onClick={() => setLinkedChat(null)}
                            className="ml-0.5 rounded-full px-1 hover:bg-[color-mix(in_srgb,var(--edited)_20%,transparent)]"
                            title="Remove link"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="mb-2.5">
                          <input
                            value={linkQuery}
                            onChange={(e) => setLinkQuery(e.target.value)}
                            placeholder="link to another chat — search by group name (optional)"
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-[var(--primary)]"
                          />
                          {linkResults.length > 0 && (
                            <div className="mt-1 overflow-hidden rounded-lg border border-border bg-background">
                              {linkResults.map((c) => (
                                <button
                                  key={c.chat_id}
                                  onClick={() => {
                                    setLinkedChat({ chat_id: c.chat_id, chat_name: c.name });
                                    setLinkResults([]);
                                    setLinkQuery("");
                                  }}
                                  className="block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--hover)]"
                                >
                                  {c.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={doUnflag}
                          disabled={unflagging}
                          className="inline-flex items-center gap-2 rounded-lg bg-[var(--edited)] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                        >
                          {unflagging ? "Unflagging…" : "⚑ Unflag"}
                        </button>
                        <button
                          onClick={() => setUnflagOpen(false)}
                          className="rounded-lg px-3 py-2 text-[13px] text-[var(--muted-foreground)] hover:bg-[var(--hover)]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Collapsible full thread */}
                  <button
                    onClick={() => setThreadOpen((o) => !o)}
                    className="mb-3 flex w-full items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-left text-[12px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--hover)]"
                  >
                    <span
                      className="text-[var(--faint)] transition-transform"
                      style={{ transform: threadOpen ? "rotate(90deg)" : "none" }}
                    >
                      ▸
                    </span>
                    {threadOpen ? "Hide" : "Show"} full conversation
                    <span className="text-[var(--faint)]">
                      ({(fuCur.thread_json || []).length} message
                      {(fuCur.thread_json || []).length === 1 ? "" : "s"})
                    </span>
                    <span className="ml-auto text-[11px] text-[var(--faint)]">🚩 marks what you flagged</span>
                  </button>
                  {threadOpen && (
                    <>
                      <div className="flex-1" />
                      {(fuCur.thread_json || []).map((b, i) => {
                        const me = isBryan(b.from);
                        const flagged = b.is_flagged;
                        return (
                          <div key={i} className={"mb-4 max-w-[82%] " + (me ? "ml-auto" : "")}>
                            <div className={"mb-1 flex items-center gap-2 " + (me ? "justify-end" : "")}>
                              {flagged && (
                                <span className="rounded-full bg-[var(--primary)] px-1.5 py-px text-[9.5px] font-semibold text-[var(--primary-foreground)]">
                                  🚩 flagged
                                </span>
                              )}
                              <span className="text-[12px] font-medium text-[var(--muted-foreground)]">
                                {me ? "You" : b.from}
                              </span>
                              <span className="text-[10.5px] tabular-nums text-[var(--faint)]">{b.t}</span>
                            </div>
                            <span
                              className={
                                "inline-block whitespace-pre-wrap px-[13px] py-[9px] text-[13.5px] " +
                                (me
                                  ? "rounded-[14px_4px_14px_14px] bg-[var(--accent)]"
                                  : "rounded-[4px_14px_14px_14px] bg-[var(--hover)]") +
                                (flagged
                                  ? " ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)]"
                                  : "")
                              }
                            >
                              {b.text}
                            </span>
                          </div>
                        );
                      })}
                      {fuCur && (
                        <p className="mb-1 mt-2 text-[11.5px] text-[var(--faint)]">
                          {fuCur.waiting_state === "waiting_on_them"
                            ? `Conversation ends on your message · no reply for ${ageLabel(fuCur.last_activity_days)}.`
                            : `Conversation ends on ${fuCur.last_from}'s reply · likely just needs a short acknowledgement.`}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* composer */}
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
                    placeholder={!base ? "looks handled — edit here if you still want to nudge" : undefined}
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
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-center text-[var(--muted-foreground)]">
              <div>
                <div className="mb-2.5 text-3xl">✓</div>
                <div className="mb-1 text-[15px] font-semibold text-foreground">All caught up</div>
                <div className="text-[13px]">No flagged threads waiting.</div>
              </div>
            </div>
          )}
        </main>
      </div>

      <div
        className={
          "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[9px] bg-foreground px-4 py-2 text-[13px] text-background transition-all " +
          (toast ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")
        }
      >
        {toast}
      </div>
    </>
  );
}
