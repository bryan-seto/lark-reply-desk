import { NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Related-chat search for the unflag link picker. Shells out to lark-cli
// im +chat-search (the daemon's identity / keychain token is used because the
// child inherits HOME + nvm PATH, exactly like the send daemon). Best-effort:
// on ANY error, returns [] so the picker degrades to "no matches" rather than
// 500-ing. Read-only (search), never mutates.
const LARK_CLI = "/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin/lark-cli";
const NODE_BIN = "/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin";

function run(args: string[], timeoutMs = 12000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(LARK_CLI, args, {
      env: { ...process.env, HOME: "/Users/bryan.seto", PATH: `${NODE_BIN}:${process.env.PATH ?? ""}` },
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, out });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 1, out });
    });
  });
}

type ChatHit = { chat_id: string; name: string };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json([]);

  try {
    const { code, out } = await run([
      "im", "+chat-search", "--query", q, "--as", "user",
      "--page-size", "8", "--format", "json",
    ]);
    if (code !== 0 || !out.trim()) return NextResponse.json([]);
    const parsed = JSON.parse(out);
    // lark-cli wraps results under data.items (chat objects with chat_id + name)
    const items: unknown[] =
      parsed?.data?.items ?? parsed?.items ?? parsed?.data?.chats ?? [];
    const hits: ChatHit[] = [];
    for (const it of items) {
      const o = it as Record<string, unknown>;
      const chat_id = String(o.chat_id ?? o.id ?? "");
      const name = String(o.name ?? o.chat_name ?? "");
      if (chat_id && name) hits.push({ chat_id, name });
      if (hits.length >= 6) break;
    }
    return NextResponse.json(hits);
  } catch {
    return NextResponse.json([]);
  }
}
