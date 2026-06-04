// Server-only helpers that bridge the Reply Desk UI to the Lark draft daemon's
// JSONL state files. The UI NEVER calls lark-cli; the daemon (which holds the
// macOS keychain) executes sends. We only read the queue and exchange command/
// result lines with it.
import { promises as fs } from "fs";
import { randomUUID } from "crypto";

const STATE_DIR = "/Users/bryan.seto/.hermes/profiles/bryan/state";
export const QUEUE_PATH = `${STATE_DIR}/lark-reply-desk-queue.jsonl`;
export const CMD_PATH = `${STATE_DIR}/lark-reply-desk-commands.jsonl`;
export const RESULTS_PATH = `${STATE_DIR}/lark-reply-desk-results.jsonl`;

export type ThreadMsg = { t: string; from: string; text: string };
export type QueueRow = {
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
export type SendResult = {
  id: string;
  handle: string;
  status: "sent" | "error" | "queued";
  detail?: string;
  ts?: number;
};

// Parse a JSONL file leniently: skip blank/corrupt lines, never throw on a
// missing file (the daemon may not have written anything yet).
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

export async function readQueue(
  status: "pending" | "sent" = "pending"
): Promise<QueueRow[]> {
  const rows = await readJsonl<QueueRow>(QUEUE_PATH);
  return rows
    .filter((r) => (r.status ?? "pending") === status)
    .sort((a, b) => (b.drafted_at ?? 0) - (a.drafted_at ?? 0));
}

// Append a send command for the daemon, then poll the results file for the
// matching id. If the daemon hasn't processed it within the window, return a
// non-error "queued" status — the command persists and runs on the next cycle.
// opts.queue="followup" routes to the Follow-up Desk send branch (flag kept).
export async function sendViaDaemon(
  handle: string,
  sentText: string,
  opts: { queue?: "followup"; timeoutMs?: number } = {}
): Promise<SendResult> {
  const { queue, timeoutMs = 12000 } = opts;
  const id = randomUUID();
  const cmd: Record<string, unknown> = { id, handle, action: "send", sent_text: sentText };
  if (queue) cmd.queue = queue;
  await fs.appendFile(CMD_PATH, JSON.stringify(cmd) + "\n", "utf8");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const results = await readJsonl<SendResult>(RESULTS_PATH);
    const hit = results.find((r) => r.id === id);
    if (hit) return hit;
  }
  return { id, handle, status: "queued", detail: "daemon will process on next cycle" };
}
