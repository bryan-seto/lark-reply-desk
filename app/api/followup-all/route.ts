import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CMD_PATH = "process.env.HERMES_STATE_DIR ?? (process.env.HOME + "/.hermes/profiles/default/state")/lark-reply-desk-commands.jsonl";

export async function POST(request: Request) {
  let body: { handle?: string; draft_text?: string; batch_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", detail: "bad JSON" }, { status: 400 });
  }
  const handle = (body.handle ?? "").trim();
  if (!handle) {
    return NextResponse.json({ status: "error", detail: "missing handle" }, { status: 400 });
  }
  const sentText = (body.draft_text ?? "").trim();
  if (!sentText) {
    return NextResponse.json({ status: "error", detail: "empty draft_text" }, { status: 400 });
  }
  const id = randomUUID();
  const batchId = body.batch_id ?? `fua_${Date.now()}`;
  const cmd = {
    id,
    handle,
    action: "followup_all",
    sent_text: sentText,
    batch_id: batchId,
    freshness_check: true,
    queue: "followup",
  };
  try {
    await fs.appendFile(CMD_PATH, JSON.stringify(cmd) + "\n", "utf8");
    return NextResponse.json({ status: "queued", id, batch_id: batchId });
  } catch (err) {
    return NextResponse.json(
      { status: "error", detail: String(err) },
      { status: 500 }
    );
  }
}
