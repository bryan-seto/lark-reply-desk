// Build a Lark applink that opens the flagged conversation in the native Lark app.
//
// HARD-WON LESSON (2026-06-09, three formats tested against Bryan's live Lark):
//   1. message_link/open?messageId=om_...           → "This page is unavailable" (no such link)
//   2. thread/open?...&thread_position=N (Lark's own message_app_link)
//                                                    → launches Lark but DOES NOT navigate when the
//                                                      app is already running (browser→app handoff
//                                                      drops the in-app nav; known Electron behavior)
//   3. chat/open?openChatId=oc_...                   → reliably navigates to the GROUP (top level)
//
// So #3 is the ceiling for a browser→native-app handoff: it lands Bryan in the
// right conversation (he scrolls to find the message). #2 looked "more correct"
// but is worse in practice because it navigates nowhere. We deliberately use
// chat/open even though row.applink (a thread/open link) is available.
//
// `applink` is still captured on the row as dormant data — if Lark fixes
// browser-handoff navigation, or we add a "copy link" button (in-app paste works),
// it's there. It is intentionally NOT used to build the click-through href.

export type DeepLinkRow = {
  chat_id: string;
  thread_id?: string | null;
  applink?: string | null;
};

export function larkDeepLink(row: DeepLinkRow): string {
  // chat/open is the only form that reliably navigates from an external browser
  // into an already-running Lark desktop app. Lands at the group; user scrolls.
  return `https://applink.larksuite.com/client/chat/open?openChatId=${encodeURIComponent(
    row.chat_id,
  )}`;
}
