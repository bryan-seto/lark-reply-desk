import { describe, it, expect } from "vitest";
import { larkDeepLink } from "../lib/larkDeepLink";

describe("larkDeepLink", () => {
  const CHAT_ID = "oc_testchat123";
  const THREAD_ID = "omt_testthread456";

  // 1. Always opens via chat/open with the chat id
  it("builds a chat/open applink with the chat id", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID });
    expect(url).toContain("client/chat/open");
    expect(url).toContain(`openChatId=${CHAT_ID}`);
  });

  // 2. Appends open_thread_id when thread_id is present
  it("appends open_thread_id when thread_id is present", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: THREAD_ID });
    expect(url).toContain(`openChatId=${CHAT_ID}`);
    expect(url).toContain(`open_thread_id=${THREAD_ID}`);
  });

  // 3. Omits open_thread_id when thread_id is undefined
  it("omits open_thread_id when thread_id is undefined", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: undefined });
    expect(url).not.toContain("open_thread_id");
  });

  // 4. Omits open_thread_id when thread_id is null
  it("omits open_thread_id when thread_id is null", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: null });
    expect(url).not.toContain("open_thread_id");
  });

  // 5. Omits open_thread_id when thread_id is empty string
  it("omits open_thread_id when thread_id is empty string", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: "" });
    expect(url).not.toContain("open_thread_id");
  });

  // 6. Uses applink.larksuite.com (NOT feishu.cn) and never the invalid message_link path
  it("uses applink.larksuite.com domain and never message_link", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: THREAD_ID });
    expect(url).toContain("applink.larksuite.com");
    expect(url).not.toContain("feishu.cn");
    expect(url).not.toContain("message_link");
  });

  // 7. URL-encodes ids that contain special characters
  it("URL-encodes a chat_id that contains special characters", () => {
    const specialChatId = "oc_test+chat/123";
    const url = larkDeepLink({ chat_id: specialChatId });
    expect(url).not.toMatch(/oc_test\+chat\/123/);
    expect(url).toContain("oc_test%2Bchat%2F123");
  });
});
