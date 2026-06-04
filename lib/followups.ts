// Server-only reader for the Follow-up Desk queue. The harvester
// (flag_followup_harvest.py) writes lark-followup-queue.jsonl with one row per
// flagged thread, already ordered newest-flagged first. The UI only reads it;
// sends go through the daemon (Option B) with queue:"followup".
import { promises as fs } from "fs";

const STATE_DIR = "/Users/bryan.seto/.hermes/profiles/bryan/state";
export const FOLLOWUP_QUEUE_PATH = `${STATE_DIR}/lark-followup-queue.jsonl`;

export type FollowupThreadMsg = { t: string; from: string; text: string; is_flagged?: boolean };
export type RefineSource = { type: string; name: string; quote: string };
export type FollowupRow = {
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
  // thread summary + about (analyze_thread)
  summary?: string;
  about_subject?: string;
  about_owner?: string;
  // rule-based suggested follow-up date
  suggested_date?: string;
  suggested_label?: string;
  suggested_reason?: string;
  suggested_days_out?: number;
  thread_json: FollowupThreadMsg[];
  draft_text: string;
  drafted_at: number;
  status: "pending" | "sent";
  sent_text?: string;
};

async function readJsonl<T>(path: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      /* skip partial/corrupt line */
    }
  }
  return out;
}

// Preserve the harvester's file order (newest-flagged / latest-activity first).
// Do NOT re-sort by drafted_at — the harvester already encodes Bryan's preferred
// order, and every row in a single harvest shares ~the same drafted_at.
export async function readFollowups(
  status: "pending" | "sent" = "pending"
): Promise<FollowupRow[]> {
  const rows = await readJsonl<FollowupRow>(FOLLOWUP_QUEUE_PATH);
  return rows.filter((r) => (r.status ?? "pending") === status);
}
