export type DeepLinkRow = {
  flag_message_id?: string | null;
  chat_id: string;
};

export function larkDeepLink(row: DeepLinkRow): string {
  if (row.flag_message_id) {
    return `https://applink.larksuite.com/client/message_link/open?messageId=${encodeURIComponent(row.flag_message_id)}`;
  }
  return `https://applink.larksuite.com/client/chat_link/open?openChatId=${encodeURIComponent(row.chat_id)}`;
}
