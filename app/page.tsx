"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DraftComposer from "@/components/DraftComposer";
import { larkDeepLink } from "@/lib/larkDeepLink";

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
  applink?: string;
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
  status: "pending" | "sent" | "parked";
  sent_text?: string;
  // park fields
  topic_tag?: string;
  parked_at?: number;
  parked_reason?: string;
  new_activity_since_park?: boolean;
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
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unflag + link-to-related-chat (Plan A)
  const [unflagOpen, setUnflagOpen] = useState(false);
  const [unflagNote, setUnflagNote] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<{ chat_id: string; name: string }[]>([]);
  const [linkedChat, setLinkedChat] = useState<{ chat_id: string; chat_name: string } | null>(null);
  const [unflagging, setUnflagging] = useState(false);

  // park — waiting on them, unflag from Lark, survive harvest
  const [parkOpen, setParkOpen] = useState(false);
  const [parkReason, setParkReason] = useState("");
  const [parkTag, setParkTag] = useState("");
  const [parking, setParking] = useState(false);
  const [parkedRows, setParkedRows] = useState<FollowupRow[]>([]);
  const [parkedTab, setParkedTab] = useState(false);

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
      }
    } catch {
      setFuRows([]);
    }
  }, []);

  function openFu(r: FollowupRow) {
    setFuHandle(r.handle);
    setThreadOpen(false);
    // reset unflag popover
    setUnflagOpen(false);
    setUnflagNote("");
    setLinkQuery("");
    setLinkResults([]);
    setLinkedChat(null);
    // reset park popover
    setParkOpen(false);
    setParkReason("");
    setParkTag(r.topic_tag || "");
    // reset correction panel
    setFixOpen(false);
    setFixDate(r.suggested_date || "");
    setFixPerson(r.person || "");
    setFixNl("");
    setFixStatus("");
    setFixLearned("");
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lrd-theme", next ? "dark" : "light");
    } catch {}
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

  // free-text correction -> NL mode
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

  function showToast(t: string) {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }

  // debounced related-chat search for the unflag link picker
  useEffect(() => {
    if (!unflagOpen) return;
    const q = linkQuery.trim();
    if (q.length < 2) { setLinkResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/followups/related?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = await res.json();
        setLinkResults(Array.isArray(data) ? data : []);
      } catch { setLinkResults([]); }
    }, 320);
    return () => clearTimeout(t);
  }, [linkQuery, unflagOpen]);

  // remove the current row from the rail + advance to next
  function dropCurrentRow(handle: string) {
    const remaining = fuRows.filter((x) => x.handle !== handle);
    setFuRows(remaining);
    const top = sortFu(remaining)[0];
    if (top) openFu(top);
    else setFuHandle(null);
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
        body: JSON.stringify({ handle: activeHandle, action: "unflag", note: unflagNote, link: linkedChat }),
      });
      const r = await res.json();
      if (r.status === "unflagged") {
        showToast(linkedChat ? "Unflagged · linked" : "Unflagged");
        setUnflagOpen(false);
        dropCurrentRow(activeHandle);
      } else if (r.status === "queued") {
        showToast("Queued — Lark will remove the flag within ~60s");
        setUnflagOpen(false);
        dropCurrentRow(activeHandle);
      } else if (r.status === "error") {
        // Flag-cancel partial success: message layer likely removed even if daemon
        // reported error. Drop the row to avoid stuck UI; next harvest will confirm.
        showToast("Unflagged — Lark may take a moment to confirm");
        setUnflagOpen(false);
        dropCurrentRow(activeHandle);
      } else {
        showToast(`Unflag failed: ${r.detail || "unknown"}`);
      }
    } catch {
      showToast("Unflag failed — check connection and retry");
    } finally {
      setUnflagging(false);
    }
  }

  async function doPark() {
    if (parking || !fuCur) return;
    const activeHandle = fuCur.handle;
    setParking(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: activeHandle,
          action: "park",
          reason: parkReason,
          topic_tag: parkTag.trim() || undefined,
        }),
      });
      const r = await res.json();
      if (r.status === "parked" || r.status === "queued") {
        showToast(r.status === "parked" ? "Parked — will resurface when they reply" : "Queued — parking on next cycle");
        setParkOpen(false);
        dropCurrentRow(activeHandle);
        // refresh parked list
        fetch("/api/followups?status=parked", { cache: "no-store" })
          .then((x) => x.json())
          .then((d) => setParkedRows(Array.isArray(d) ? d : []))
          .catch(() => {});
      } else {
        showToast(`Park failed: ${r.detail || "unknown"}`);
      }
    } catch {
      showToast("Park failed — check connection");
    } finally {
      setParking(false);
    }
  }

  // load parked rows whenever parked tab opens
  useEffect(() => {
    if (!parkedTab) return;
    fetch("/api/followups?status=parked", { cache: "no-store" })
      .then((x) => x.json())
      .then((d) => setParkedRows(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [parkedTab]);

  // apply a structured correction
  useEffect(() => {
    loadFu(fuHandleRef.current);
    const iv = setInterval(() => loadFu(fuHandleRef.current), 15000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounced related-chat search for the unflag link picker

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
            <button
              onClick={() => setParkedTab(false)}
              className={"text-[15px] font-semibold " + (!parkedTab ? "text-foreground" : "text-[var(--faint)] hover:text-foreground")}
            >
              Flagged
            </button>
            <span className="rounded-full bg-[var(--hover)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted-foreground)]">
              {fuRows.length}
            </span>
            {dueNow > 0 && (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--primary)]">
                {dueNow} due now
              </span>
            )}
            <span className="mx-1 text-[var(--sidebar-border)]">|</span>
            <button
              onClick={() => setParkedTab(true)}
              className={"text-[15px] font-semibold " + (parkedTab ? "text-foreground" : "text-[var(--faint)] hover:text-foreground")}
            >
              Parked
            </button>
            {parkedRows.filter((r) => r.new_activity_since_park).length > 0 && (
              <span className="rounded-full bg-[color-mix(in_srgb,#cb912f_20%,transparent)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#cb912f]">
                {parkedRows.filter((r) => r.new_activity_since_park).length} replied
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
            {parkedTab ? "waiting for them to reply" : "sorted by when you need to act"}
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {parkedTab ? (
              // ---- PARKED TAB ----
              parkedRows.length === 0 ? (
                <div className="px-3.5 py-10 text-center text-[13px] text-[var(--faint)]">
                  No parked threads.
                </div>
              ) : (
                (() => {
                  // group by topic_tag; untagged at bottom
                  const groups: Record<string, FollowupRow[]> = {};
                  for (const r of parkedRows) {
                    const k = r.topic_tag?.trim() || "";
                    (groups[k] = groups[k] || []).push(r);
                  }
                  const tagged = Object.keys(groups).filter((k) => k).sort();
                  const untagged = groups[""] || [];
                  const allGroups = [...tagged.map((k) => ({ key: k, rows: groups[k] })), ...(untagged.length ? [{ key: "", rows: untagged }] : [])];
                  return allGroups.map(({ key, rows }) => (
                    <div key={key || "__untagged__"}>
                      {key && (
                        <div className="mb-1 mt-3 flex items-center gap-1.5 px-2 first:mt-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#cb912f]" />
                          <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#cb912f]">
                            {key}
                          </span>
                        </div>
                      )}
                      {rows.map((r) => (
                        <div
                          role="button"
                          tabIndex={0}
                          key={r.handle}
                          onClick={() => { setParkedTab(false); openFu(r); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setParkedTab(false); openFu(r); } }}
                          className="mb-px grid w-full gap-[2px] rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover)] group"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="grid h-[20px] w-[20px] flex-none place-items-center rounded-md text-[9px] font-semibold text-white"
                              style={{ background: colorFor(r.person) }}
                            >
                              {initials(r.person)}
                            </span>
                            <span className="truncate text-[13px] font-semibold">{r.person}</span>
                            <div className="ml-auto flex items-center gap-1">
                              {r.new_activity_since_park && (
                                <span className="whitespace-nowrap rounded-full bg-[color-mix(in_srgb,#cb912f_20%,transparent)] px-1.5 py-px text-[10px] font-semibold text-[#cb912f]">
                                  replied
                                </span>
                              )}
                              <a
                                href={larkDeepLink(r)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex-none rounded p-0.5 text-[11px] text-[var(--faint)] opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-[var(--hover)] hover:text-[var(--primary)]"
                                aria-label="Open this thread in Lark"
                                title="Open this thread in Lark"
                                tabIndex={-1}
                              >
                                ↗
                              </a>
                            </div>
                          </div>
                          <div className="truncate pl-[28px] text-[12.5px] font-medium">
                            {r.about_subject || r.summary || "Parked thread"}
                          </div>
                          {r.parked_reason && (
                            <div className="truncate pl-[28px] text-[11.5px] text-[var(--faint)]">
                              {r.parked_reason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ));
                })()
              )
            ) : (
              // ---- FLAGGED TAB ----
              sorted.length === 0 ? (
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
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openFu(r)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFu(r); } }}
                        aria-current={selected}
                        className={
                          "mb-px grid w-full gap-[2px] rounded-lg px-2.5 py-2 text-left transition-colors group " +
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
                          <div className="ml-auto flex items-center gap-1">
                            {r.suggested_label && (
                              <span
                                className="whitespace-nowrap text-[10.5px] font-semibold"
                                style={{ color: URGENCY_COLOR[u.key] }}
                              >
                                {r.suggested_label}
                              </span>
                            )}
                            <a
                              href={larkDeepLink(r)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex-none rounded p-0.5 text-[11px] text-[var(--faint)] opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-[var(--hover)] hover:text-[var(--primary)]"
                              aria-label="Open this thread in Lark"
                              title="Open this thread in Lark"
                              tabIndex={-1}
                            >
                              ↗
                            </a>
                          </div>
                        </div>
                        <div className="truncate pl-[28px] text-[12.5px] font-medium">
                          {r.about_subject || r.summary || "Flagged thread"}
                        </div>
                        <div className="truncate pl-[28px] text-[11.5px] text-[var(--muted-foreground)]">
                          {actionLine(r)}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()
            )
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
                            setParkOpen(false);
                          }}
                          className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--primary)]"
                          title="Fix this — correct the status, date, or what-to-do (Hermes learns from it)"
                        >
                          ✎ Fix this
                        </button>
                        <button
                          onClick={() => {
                            setParkOpen((o) => !o);
                            setUnflagOpen(false);
                            setFixOpen(false);
                          }}
                          className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[#cb912f]"
                          title="Park — unflag from Lark, resurfaces when they reply"
                        >
                          ⏸ Park
                        </button>
                        <button
                          onClick={() => {
                            setUnflagOpen((o) => !o);
                            setFixOpen(false);
                            setParkOpen(false);
                          }}
                          className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--edited)]"
                          title="Unflag — remove the Lark bookmark"
                        >
                          ⚑ Unflag
                        </button>
                        <a
                          href={larkDeepLink(fuCur)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--primary)]"
                          title={fuCur.applink ? "Jump to the flagged message in Lark" : fuCur.thread_id ? "Open this thread in Lark" : "Open chat in Lark"}
                          aria-label={fuCur.applink ? "Jump to the flagged message in Lark" : fuCur.thread_id ? "Open this thread in Lark" : "Open chat in Lark"}
                        >
                          <span aria-hidden="true">↗</span> Open
                        </a>
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

                  {/* Park popover (⏸ Park) */}
                  {parkOpen && (
                    <div className="mb-3 rounded-[12px] border border-[#cb912f] bg-[color-mix(in_srgb,#cb912f_6%,transparent)] px-4 py-3.5">
                      <div className="mb-1 text-[12px] font-semibold text-[#cb912f]">Park this thread</div>
                      <div className="mb-2.5 text-[11.5px] text-[var(--muted-foreground)]">
                        Unflag from Lark so it doesn&apos;t clutter your queue. Desk keeps the row — auto-resurfaces when they reply.
                      </div>
                      <input
                        value={parkReason}
                        onChange={(e) => setParkReason(e.target.value)}
                        placeholder="why parking? (e.g. waiting for Edgar to reply on the MCP proposal)"
                        className="mb-2.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-[#cb912f]"
                      />
                      <div className="mb-2.5 flex items-center gap-2">
                        <span className="text-[11.5px] text-[var(--faint)]">🏷 Topic tag</span>
                        <input
                          value={parkTag}
                          onChange={(e) => setParkTag(e.target.value)}
                          placeholder="e.g. MCP Platform (groups related threads)"
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-[#cb912f]"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={doPark}
                          disabled={parking}
                          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                          style={{ background: "#cb912f" }}
                        >
                          {parking ? "Parking…" : "⏸ Park"}
                        </button>
                        <button
                          onClick={() => setParkOpen(false)}
                          className="rounded-lg px-3 py-2 text-[13px] text-[var(--muted-foreground)] hover:bg-[var(--hover)]"
                        >
                          Cancel
                        </button>
                      </div>
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
              <DraftComposer
                fuHandle={fuHandle}
                initialDraft={fuCur?.draft_text ?? ""}
                pendingFix={fuCur?.pending_fix}
                onSent={(handle) => {
                  const remaining = fuRows.filter((x) => x.handle !== handle);
                  setFuRows(remaining);
                  const top = sortFu(remaining)[0];
                  if (top) openFu(top);
                  else setFuHandle(null);
                  setTimeout(() => loadFu(null), 1500);
                }}
                onToast={showToast}
              />
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
