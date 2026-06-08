// Helpers for the "↗ Open in Lark" affordance.
//
// CEILING (verified against Bryan's live Lark, 2026-06-09): a browser→native-app
// handoff can only reliably land in the GROUP (chat/open). thread/open does not
// navigate at all, and message/position params on chat/open are ignored. So the
// deep link gets Bryan into the right group; an in-chat search (⌘F) on the
// flagged message text is what jumps to the exact message.

export type DeepLinkRow = {
  chat_id: string;
  thread_id?: string | null;
  applink?: string | null;
};

export function larkDeepLink(row: DeepLinkRow): string {
  // chat/open is the only form that reliably navigates from an external browser
  // into an already-running Lark desktop app. Lands at the group; user searches.
  return `https://applink.larksuite.com/client/chat/open?openChatId=${encodeURIComponent(
    row.chat_id,
  )}`;
}

// Turn the flagged message text into a clean, paste-ready search term for Lark's
// in-chat search. Must be REAL message text (not an AI subject) so Lark finds it.
// - collapse whitespace/newlines to single spaces
// - strip a leading mention/emoji noise that hurts search matching
// - cap to a short distinctive phrase (Lark search is token-based; ~8 words is
//   precise without being so long that formatting/typos break the match)
export function larkSearchSnippet(flaggedText: string | undefined | null): string {
  if (!flaggedText) return "";
  const cleaned = flaggedText
    .replace(/\s+/g, " ")
    .replace(/^[\s@#]+/, "")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ");
  if (words.length <= 8) return cleaned;
  return words.slice(0, 8).join(" ");
}
