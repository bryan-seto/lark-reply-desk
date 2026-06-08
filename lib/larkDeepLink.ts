// Build a Lark applink that opens the flagged conversation in the native Lark app.
//
// IMPORTANT (verified 2026-06-09): there is NO reliable way to CONSTRUCT a
// "jump to this exact message" deep link by hand. Lark itself returns a
// `message_app_link` on every message (the same link "Copy link" produces) —
// a `client/thread/open` URL carrying `open_thread_id` AND `thread_position`,
// which is what actually lands on the specific message. The harvester now
// captures that into `row.applink`.
//
// Precedence:
//   1. row.applink            — Lark's own link (best; lands on the message)
//   2. thread/open fallback   — when applink is missing but we have a thread
//   3. chat/open fallback     — non-threaded flags (chat-level only)
//
// A hand-built `message_link/open?messageId=om_...` does NOT work (Lark shows
// "This page is unavailable") and must never be used.

export type DeepLinkRow = {
  chat_id: string;
  thread_id?: string | null;
  applink?: string | null;
};

export function larkDeepLink(row: DeepLinkRow): string {
  // 1. Prefer Lark's own message link — it lands on the exact flagged message.
  if (row.applink) {
    return row.applink;
  }

  const chat = encodeURIComponent(row.chat_id);

  // 2. Threaded flag without a stored applink → open the thread (lands in-thread,
  //    just not on the exact message).
  if (row.thread_id) {
    const thread = encodeURIComponent(row.thread_id);
    return (
      `https://applink.larksuite.com/client/thread/open` +
      `?open_chat_id=${chat}&open_thread_id=${thread}` +
      `&openchatid=${chat}&openthreadid=${thread}`
    );
  }

  // 3. Non-threaded flag → chat-level open.
  return `https://applink.larksuite.com/client/chat/open?openChatId=${chat}`;
}
