"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ThreadMsg = { t: string; from: string; text: string; is_flagged?: boolean };
type QueueRow = {
  handle: string;
  chat_id: string;
  chat_name: string;
  sender_name: string;
  parent_message_id: string;
  thread_json: ThreadMsg[];
  draft_text: string;
  drafted_at: number;
  status: "pending" | "sent";
  sent_text?: string;
};
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
  suggested_date?: string;
  suggested_label?: string;
  suggested_reason?: string;
  suggested_days_out?: number;
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
const fmtTime = (epoch: number) => {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const COLORS = ["#2383e2", "#0f9d6b", "#cb912f", "#9333ea", "#0ea5e9", "#e0517a"];
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
};
const ageLabel = (d: number) => (d <= 0 ? "today" : `${d}d`);

type Mode = "unread" | "followup";

export default function Home() {
  const [mode, setMode] = useState<Mode>("unread");

  // ---- Unread (reply desk) state ----
  const [filter, setFilter] = useState<"pending" | "sent">("pending");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [curHandle, setCurHandle] = useState<string | null>(null);

  // ---- Follow-up state ----
  const [fuRows, setFuRows] = useState<FollowupRow[]>([]);
  const [fuHandle, setFuHandle] = useState<string | null>(null);

  // ---- shared composer ----
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- refine-with-context state (Follow-up only) ----
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstr, setRefineInstr] = useState("");
  const [useObsidian, setUseObsidian] = useState(true);
  const [useMemory, setUseMemory] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineStatus, setRefineStatus] = useState("");
  const [refineSources, setRefineSources] = useState<RefineSource[]>([]);

  const cur = rows.find((r) => r.handle === curHandle) || null;
  const fuCur = fuRows.find((r) => r.handle === fuHandle) || null;
  const edited = draft.trim() !== base.trim();

  // ---------- Unread loaders ----------
  const load = useCallback(async (f: "pending" | "sent", keep?: string | null) => {
    try {
      const res = await fetch(`/api/inbox?status=${f}`, { cache: "no-store" });
      const data: QueueRow[] = await res.json();
      setRows(data);
      const stillThere = keep && data.some((r) => r.handle === keep);
      if (stillThere) return;
      if (data.length) openRow(data[0]);
      else {
        setCurHandle(null);
        setDraft("");
        setBase("");
      }
    } catch {
      setRows([]);
    }
  }, []);

  function openRow(r: QueueRow) {
    setCurHandle(r.handle);
    setDraft(r.draft_text || "");
    setBase(r.draft_text || "");
  }

  // ---------- Follow-up loaders ----------
  const loadFu = useCallback(async (keep?: string | null) => {
    try {
      const res = await fetch(`/api/followups?status=pending`, { cache: "no-store" });
      const data: FollowupRow[] = await res.json();
      setFuRows(data);
      const stillThere = keep && data.some((r) => r.handle === keep);
      if (stillThere) return;
      if (data.length) openFu(data[0]);
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
    // reset refine panel for the newly opened thread
    setRefineOpen(false);
    setRefineInstr("");
    setRefineStatus("");
    setRefineSources([]);
  }

  // Refine the current follow-up draft by letting Hermes read Obsidian + memory.
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

  // load per mode + light polling
  useEffect(() => {
    if (mode === "unread") {
      load(filter, curHandle);
      const iv = setInterval(() => load(filter, curHandle), 15000);
      return () => clearInterval(iv);
    } else {
      loadFu(fuHandle);
      const iv = setInterval(() => loadFu(fuHandle), 15000);
      return () => clearInterval(iv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, filter]);

  // theme init
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

  // auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [draft, curHandle, fuHandle, mode]);

  // ---------- send (both modes) ----------
  async function send() {
    if (sending) return;
    const activeHandle = mode === "unread" ? cur?.handle : fuCur?.handle;
    if (!activeHandle) return;
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: activeHandle,
          sent_text: draft,
          ...(mode === "followup" ? { queue: "followup" } : {}),
        }),
      });
      const r = await res.json();
      if (r.status === "sent") {
        showToast(
          mode === "followup"
            ? "Sent · flag kept"
            : edited
            ? "Sent · your edit was saved as a style signal"
            : "Sent"
        );
      } else if (r.status === "queued") {
        showToast("Queued · sends on the daemon's next cycle");
      } else {
        showToast(`Send failed: ${r.detail || "unknown"}`);
        setSending(false);
        return;
      }
      // optimistic: drop from list, advance
      if (mode === "unread") {
        const remaining = rows.filter((x) => x.handle !== activeHandle);
        setRows(remaining);
        if (remaining.length) openRow(remaining[0]);
        else {
          setCurHandle(null);
          setDraft("");
          setBase("");
        }
        setTimeout(() => load(filter, null), 1500);
      } else {
        const remaining = fuRows.filter((x) => x.handle !== activeHandle);
        setFuRows(remaining);
        if (remaining.length) openFu(remaining[0]);
        else {
          setFuHandle(null);
          setDraft("");
          setBase("");
        }
        setTimeout(() => loadFu(null), 1500);
      }
    } catch {
      showToast("Send failed: network");
    } finally {
      setSending(false);
    }
  }

  // keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const list = mode === "unread" ? rows : fuRows;
      const handle = mode === "unread" ? curHandle : fuHandle;
      const open = mode === "unread" ? (r: QueueRow | FollowupRow) => openRow(r as QueueRow) : (r: QueueRow | FollowupRow) => openFu(r as FollowupRow);
      const i = list.findIndex((r) => r.handle === handle);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const n = list[Math.min(list.length - 1, i + 1)];
        if (n) open(n);
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const p = list[Math.max(0, i - 1)];
        if (p) open(p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, fuRows, curHandle, fuHandle, draft, sending, mode]);

  const tabCount = mode === "unread" ? (filter === "pending" ? rows.length : null) : fuRows.length;

  // active thread + header for the content pane
  const activeThread = mode === "unread" ? cur : fuCur;
  const headerName = mode === "unread" ? cur?.sender_name : fuCur?.person;
  const headerSub =
    mode === "unread"
      ? cur
        ? `from ${cur.sender_name}`
        : ""
      : fuCur
      ? `${fuCur.chat_name} · flagged`
      : "";

  return (
    <div className="grid h-screen w-screen grid-cols-[320px_1fr] overflow-hidden">
      {/* SIDEBAR */}
      <aside className="flex min-h-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
        {/* top-level mode tabs */}
        <div className="flex items-center gap-2 px-3.5 pb-1 pt-3">
          <div className="inline-flex flex-1 rounded-[7px] bg-[var(--hover)] p-0.5">
            {(["unread", "followup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  "flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-3 py-1 text-[12.5px] font-semibold transition-colors " +
                  (mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-[var(--muted-foreground)]")
                }
              >
                {m === "unread" ? "Unread" : "Follow-ups"}
                {m === "followup" && fuRows.length > 0 && (
                  <span className="rounded-full bg-[var(--hover)] px-1.5 text-[10.5px] text-[var(--muted-foreground)]">
                    {fuRows.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="rounded-md p-1 text-[15px] leading-none text-[var(--faint)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            ◐
          </button>
        </div>

        {/* sub-header line */}
        {mode === "unread" ? (
          <div className="mx-3.5 mb-2 mt-1 inline-flex rounded-[7px] bg-[var(--hover)] p-0.5">
            {(["pending", "sent"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={
                  "flex-1 rounded-[5px] px-3 py-1 text-[12px] font-medium transition-colors " +
                  (filter === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-[var(--muted-foreground)]")
                }
              >
                {f === "pending" ? "Needs reply" : "Done"}
              </button>
            ))}
          </div>
        ) : (
          <div className="px-[18px] pb-2 pt-1.5">
            <div className="text-[11px] text-[var(--faint)]">
              flagged threads · latest activity first
            </div>
          </div>
        )}

        {/* list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 pt-0.5">
          {mode === "unread" ? (
            rows.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-[13px] text-[var(--faint)]">
                {filter === "pending" ? "No drafts waiting." : "Nothing sent yet."}
              </div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.handle}
                  onClick={() => openRow(r)}
                  aria-current={r.handle === curHandle}
                  className={
                    "mb-px grid w-full gap-[3px] rounded-lg px-2.5 py-[9px] text-left transition-colors " +
                    (r.handle === curHandle ? "bg-[var(--accent)]" : "hover:bg-[var(--hover)]")
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md text-[10px] font-semibold text-white"
                      style={{ background: colorFor(r.sender_name) }}
                    >
                      {initials(r.sender_name)}
                    </span>
                    <span className="truncate text-[13.5px] font-medium">{r.sender_name}</span>
                    {r.status === "pending" && (
                      <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--primary)]" />
                    )}
                    <span className="ml-auto whitespace-nowrap text-[11px] text-[var(--faint)]">
                      {fmtTime(r.drafted_at)}
                    </span>
                  </div>
                  <div className="truncate pl-[30px] text-[11px] text-[var(--faint)]">
                    {r.chat_name}
                  </div>
                  <div className="line-clamp-2 pl-[30px] text-[12.5px] text-[var(--muted-foreground)]">
                    {r.draft_text}
                  </div>
                </button>
              ))
            )
          ) : fuRows.length === 0 ? (
            <div className="px-3.5 py-8 text-center text-[13px] text-[var(--faint)]">
              No flagged follow-ups. Harvest runs weekday mornings.
            </div>
          ) : (
            fuRows.map((r) => {
              const flaggedMsg =
                r.thread_json.find((m) => m.is_flagged) ||
                r.thread_json[r.thread_json.length - 1];
              const pfx = flaggedMsg
                ? isBryan(flaggedMsg.from)
                  ? "You"
                  : flaggedMsg.from
                : "";
              const status =
                r.waiting_state === "waiting_on_them"
                  ? `waiting · ${ageLabel(r.last_activity_days)}`
                  : `they replied · ${ageLabel(r.last_activity_days)}`;
              return (
                <button
                  key={r.handle}
                  onClick={() => openFu(r)}
                  aria-current={r.handle === fuHandle}
                  className={
                    "mb-px grid w-full gap-[3px] rounded-lg px-2.5 py-[9px] text-left transition-colors " +
                    (r.handle === fuHandle ? "bg-[var(--accent)]" : "hover:bg-[var(--hover)]")
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md text-[10px] font-semibold text-white"
                      style={{ background: colorFor(r.person) }}
                    >
                      {initials(r.person)}
                    </span>
                    <span className="truncate text-[13.5px] font-medium">{r.person}</span>
                    <span className="ml-auto whitespace-nowrap text-[11px] text-[var(--faint)]">
                      {ageLabel(r.last_activity_days)}
                    </span>
                  </div>
                  <div className="truncate pl-[30px] text-[11px] text-[var(--faint)]">
                    {r.chat_name}
                  </div>
                  <div className="line-clamp-2 pl-[30px] text-[12.5px] text-[var(--muted-foreground)]">
                    {r.summary ? (
                      r.summary
                    ) : (
                      <>
                        <span className="text-[var(--faint)]">🚩 {pfx}: </span>
                        {flaggedMsg?.text}
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-[30px] pt-0.5">
                    {r.suggested_label && (
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                          ((r.suggested_days_out ?? 9) <= 0
                            ? "bg-[color-mix(in_srgb,var(--edited)_16%,transparent)] text-[var(--edited)]"
                            : "bg-[var(--accent)] text-[var(--accent-foreground)]")
                        }
                      >
                        ⏰ {r.suggested_label}
                      </span>
                    )}
                    <span className="text-[10.5px] text-[var(--faint)]">{status}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* CONTENT */}
      <main className="flex min-h-0 flex-col">
        {activeThread ? (
          <>
            <div className="flex items-center gap-3 border-b border-border px-[26px] py-4">
              <span
                className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[12px] font-semibold text-white"
                style={{ background: colorFor(headerName || "") }}
              >
                {initials(headerName || "")}
              </span>
              <div>
                <div className="text-[15px] font-semibold">
                  {mode === "unread" ? cur?.chat_name : fuCur?.person}
                </div>
                <div className="text-[12px] text-[var(--muted-foreground)]">{headerSub}</div>
              </div>
              {mode === "followup" && (
                <span className="ml-auto text-[11.5px] text-[var(--faint)]">flag kept on send</span>
              )}
            </div>

            {/* thread */}
            <div className="flex flex-1 flex-col overflow-y-auto px-[26px] pb-2.5 pt-6">
              <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col">
                {mode === "followup" && fuCur && (
                  <div className="mb-4 flex flex-col gap-2.5">
                    {/* with / about */}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div className="rounded-[10px] border border-border bg-[var(--card)] px-3 py-2.5">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">
                          Follow up with
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className="grid h-5 w-5 flex-none place-items-center rounded-md text-[9px] font-semibold text-white"
                            style={{ background: colorFor(fuCur.person) }}
                          >
                            {initials(fuCur.person)}
                          </span>
                          <span className="text-[13.5px] font-semibold">{fuCur.person}</span>
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-border bg-[var(--card)] px-3 py-2.5">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">
                          About
                        </div>
                        <div className="text-[13px] font-semibold leading-snug">
                          {fuCur.about_subject || "this flagged thread"}
                        </div>
                        {fuCur.about_owner && fuCur.about_owner !== fuCur.person && (
                          <div className="mt-1 text-[11.5px] text-[var(--muted-foreground)]">
                            ⚑ owner: <b className="font-semibold text-foreground">{fuCur.about_owner}</b>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* suggested follow-up date */}
                    {fuCur.suggested_label && (
                      <div className="flex items-center gap-3 rounded-[10px] border border-border border-l-[3px] border-l-[var(--primary)] bg-[var(--card)] px-3.5 py-2.5">
                        <div className="grid h-[38px] w-[38px] flex-none place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
                          <span className="text-[15px] leading-none">⏰</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold">
                            Suggested follow-up:{" "}
                            <span className="text-[var(--primary)]">{fuCur.suggested_label}</span>
                          </div>
                          {fuCur.suggested_reason && (
                            <div className="mt-0.5 text-[11.5px] text-[var(--muted-foreground)]">
                              {fuCur.suggested_reason}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* thread summary */}
                    {fuCur.summary && (
                      <div className="rounded-[10px] border border-border bg-[var(--card)] px-3.5 py-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">
                          ▦ Thread summary
                        </div>
                        <div className="text-[13px] leading-relaxed">{fuCur.summary}</div>
                      </div>
                    )}
                  </div>
                )}
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">
                  Full conversation
                </p>
                <p className="mb-4 text-[11.5px] text-[var(--faint)]">
                  {mode === "followup"
                    ? "the whole flagged thread, every message timestamped · 🚩 marks the message you flagged"
                    : "original thread"}
                </p>
                <div className="flex-1" />
                {(activeThread.thread_json || []).map((b, i) => {
                  const me = isBryan(b.from);
                  const flagged = mode === "followup" && b.is_flagged;
                  return (
                    <div key={i} className={"mb-4 max-w-[82%] " + (me ? "ml-auto" : "")}>
                      <div
                        className={
                          "mb-1 flex items-center gap-2 " + (me ? "justify-end" : "")
                        }
                      >
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
                {mode === "followup" && fuCur && (
                  <p className="mb-1 mt-2 text-[11.5px] text-[var(--faint)]">
                    {fuCur.waiting_state === "waiting_on_them"
                      ? `Conversation ends on your message · no reply for ${ageLabel(
                          fuCur.last_activity_days
                        )}.`
                      : `Conversation ends on ${fuCur.last_from}'s reply · likely just needs a short acknowledgement.`}
                  </p>
                )}
              </div>
            </div>

            {/* composer */}
            <div className="border-t border-border bg-background px-[26px] pb-[18px] pt-4">
              <div className="mx-auto w-full max-w-[760px]">
                <div className="mb-2 flex items-center gap-2 text-[11.5px] text-[var(--muted-foreground)]">
                  <span className="text-[var(--primary)]">✦</span>
                  {mode === "followup" ? "Suggested follow-up" : "Suggested reply"}
                  <b className="font-semibold text-foreground">· drafted in your style</b>
                </div>
                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  disabled={mode === "unread" && filter === "sent"}
                  placeholder={
                    mode === "followup" && !base
                      ? "looks handled — edit here if you still want to nudge"
                      : undefined
                  }
                  className="w-full resize-none rounded-lg border border-border bg-background px-3.5 py-3 text-[14px] leading-[1.55] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-70"
                  style={{ minHeight: 80 }}
                />

                {/* FEATURE 4: refine with my context (Follow-up only) */}
                {mode === "followup" && (
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
                )}

                <div className="mt-3 flex items-center gap-3">
                  {!(mode === "unread" && filter === "sent") && (
                    <button
                      onClick={send}
                      disabled={sending}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-[13.5px] font-semibold text-[var(--primary-foreground)] transition hover:brightness-110 disabled:opacity-50"
                    >
                      {sending ? "Sending…" : mode === "followup" ? "Send follow-up" : "Send"}
                      <span className="rounded border border-white/40 px-1 text-[11px] opacity-80">
                        ⌘↵
                      </span>
                    </button>
                  )}
                  <span
                    className="ml-auto text-[11.5px] transition-colors"
                    style={{ color: edited ? "var(--edited)" : "var(--faint)" }}
                  >
                    {mode === "unread" && filter === "sent"
                      ? "sent"
                      : edited
                      ? "edited — saved as your style signal"
                      : "matches your style"}
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
              <div className="text-[13px]">
                {mode === "followup"
                  ? "No flagged follow-ups waiting."
                  : "Nothing waiting on a reply."}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* toast */}
      <div
        className={
          "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[9px] bg-foreground px-4 py-2 text-[13px] text-background transition-all " +
          (toast ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")
        }
      >
        {toast}
      </div>
    </div>
  );
}
