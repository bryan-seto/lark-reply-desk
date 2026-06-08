import { describe, it, expect } from "vitest";
import { larkDeepLink } from "../lib/larkDeepLink";

describe("larkDeepLink", () => {
  const CHAT_ID = "oc_testchat123";
  const THREAD_ID = "omt_testthread456";
  const APPLINK =
    "https://applink.larksuite.com/client/thread/open?open_chat_id=oc_testchat123&open_thread_id=omt_testthread456&thread_position=15";

  // 1. Prefers Lark's own applink when present (lands on the exact message)
  it("returns row.applink verbatim when present", () => {
    const url = larkDeepLink({
      chat_id: CHAT_ID,
      thread_id: THREAD_ID,
      applink: APPLINK,
    });
    expect(url).toBe(APPLINK);
  });

  // 2. applink wins even over a thread_id (it is strictly better)
  it("prefers applink over the thread/open fallback", () => {
    const url = larkDeepLink({
      chat_id: CHAT_ID,
      thread_id: THREAD_ID,
      applink: APPLINK,
    });
    expect(url).toContain("thread_position");
  });

  // 3. Falls back to thread/open when applink is absent but thread_id present
  it("builds a thread/open link when applink is missing but thread_id present", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: THREAD_ID });
    expect(url).toContain("client/thread/open");
    expect(url).toContain(`open_thread_id=${THREAD_ID}`);
    expect(url).toContain(`open_chat_id=${CHAT_ID}`);
  });

  // 4. Empty-string applink is treated as absent (falls back)
  it("treats empty-string applink as absent", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: THREAD_ID, applink: "" });
    expect(url).toContain("client/thread/open");
  });

  // 5. Falls back to chat/open when neither applink nor thread_id present
  it("builds a chat/open link when no applink and no thread_id", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID });
    expect(url).toContain("client/chat/open");
    expect(url).toContain(`openChatId=${CHAT_ID}`);
    expect(url).not.toContain("thread");
  });

  // 6. Fallbacks use applink.larksuite.com and never the invalid message_link path
  it("fallbacks use applink.larksuite.com and never message_link", () => {
    const threadUrl = larkDeepLink({ chat_id: CHAT_ID, thread_id: THREAD_ID });
    const chatUrl = larkDeepLink({ chat_id: CHAT_ID });
    for (const url of [threadUrl, chatUrl]) {
      expect(url).toContain("applink.larksuite.com");
      expect(url).not.toContain("feishu.cn");
      expect(url).not.toContain("message_link");
    }
  });

  // 7. Fallback URL-encodes ids that contain special characters
  it("URL-encodes ids in the fallback paths", () => {
    const url = larkDeepLink({ chat_id: "oc_test+chat/123" });
    expect(url).not.toMatch(/oc_test\+chat\/123/);
    expect(url).toContain("oc_test%2Bchat%2F123");
  });
});
