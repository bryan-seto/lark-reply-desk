import { NextResponse } from "next/server";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Correction bridge: applies a Flagged Desk correction by spawning the daemon
// CLI (same pattern as /api/refine). Structured mode (set) is deterministic;
// NL mode (nl) makes one Claude turn that distills Bryan's sentence into fields
// + a durable lesson. Both update the override store AND live-patch the queue.
const PY = "/usr/bin/python3";
const CLI = "/Users/bryan.seto/.hermes/profiles/bryan/daemons/followup_correct_cli.py";
const NODE_BIN = "/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin";

type CorrectBody = {
  handle?: string;
  set?: Record<string, string>;
  nl?: string;
  note?: string;
};

function runCli(args: string[], timeoutMs = 60000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(PY, [CLI, ...args], {
      env: { ...process.env, HOME: "/Users/bryan.seto", PATH: `${NODE_BIN}:${process.env.PATH ?? ""}` },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, out, err: err + "\n[timeout]" });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

export async function POST(request: Request) {
  let body: CorrectBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON body" }, { status: 400 });
  }
  const handle = (body.handle || "").trim();
  if (!handle) {
    return NextResponse.json({ ok: false, error: "missing handle" }, { status: 400 });
  }

  const args = ["--handle", handle];
  if (body.set && typeof body.set === "object") {
    for (const [k, v] of Object.entries(body.set)) {
      args.push("--set", `${k}=${v}`);
    }
  }
  if (body.nl && body.nl.trim()) args.push("--nl", body.nl.trim());
  if (body.note && body.note.trim()) args.push("--note", body.note.trim());

  if (args.length === 2) {
    return NextResponse.json({ ok: false, error: "nothing to correct" }, { status: 400 });
  }

  const { code, out, err } = await runCli(args);
  if (code !== 0 && !out.trim()) {
    return NextResponse.json(
      { ok: false, error: `correct failed (exit ${code})`, detail: err.slice(-400) },
      { status: 500 }
    );
  }
  try {
    const line = out.trim().split("\n").filter(Boolean).pop() || "{}";
    return NextResponse.json(JSON.parse(line));
  } catch {
    return NextResponse.json(
      { ok: false, error: "could not parse correct output", detail: out.slice(-400) },
      { status: 500 }
    );
  }
}
