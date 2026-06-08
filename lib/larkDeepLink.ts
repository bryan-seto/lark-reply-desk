// Build a Lark applink that opens the flagged conversation in the native Lark app.
//
// IMPORTANT (verified 2026-06-09): Lark has NO constructable "open this message by
// om_ id" deep link — message links require an opaque client-generated token that we
// cannot synthesise from an om_ id. The valid, constructable applink is `chat/open`
// with the chat id, plus an optional `open_thread_id` to land in the right thread.
// The earlier `message_link/open?messageId=om_...` format produced Lark's
// "This page is unavailable" error and was wrong.
//
// Format reference: lark-link-resolver skill, sections 4 & 5.

export type DeepLinkRow = {
  chat_id: string;
  thread_id?: string | null;
};

export function larkDeepLink(row: DeepLinkRow): string {
  const base = `https://applink.larksuite.com/client/chat/open?openChatId=${encodeURIComponent(
    row.chat_id,
  )}`;
  if (row.thread_id) {
    return `${base}&open_thread_id=${encodeURIComponent(row.thread_id)}`;
  }
  return base;
}
