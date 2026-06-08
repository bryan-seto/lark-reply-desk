import { describe, it, expect } from "vitest";
import { larkDeepLink } from "../lib/larkDeepLink";

describe("larkDeepLink", () => {
  const CHAT_ID = "oc_testchat123";
  const THREAD_ID = "omt_testthread456";
  const APPLINK =
    "https://applink.larksuite.com/client/thread/open?open_chat_id=oc_testchat123&open_thread_id=omt_testthread456&thread_position=15";

  // 1. Always builds chat/open with the chat id (the only form that navigates
  //    reliably from an external browser into an already-running Lark app).
  it("builds a chat/open applink with the chat id", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID });
    expect(url).toContain("client/chat/open");
    expect(url).toContain(`openChatId=${CHAT_ID}`);
  });

  // 2. Deliberately IGNORES applink (a thread/open link) — that form does not
  //    navigate on browser→app handoff, so we don't use it for the href.
  it("does NOT use row.applink for the href even when present", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, thread_id: THREAD_ID, applink: APPLINK });
    expect(url).toContain("client/chat/open");
    expect(url).not.toContain("client/thread/open");
    expect(url).not.toContain("thread_position");
  });

  // 3. Never emits the invalid message_link path or the wrong tenant domain.
  it("uses applink.larksuite.com and never message_link or feishu.cn", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID });
    expect(url).toContain("applink.larksuite.com");
    expect(url).not.toContain("feishu.cn");
    expect(url).not.toContain("message_link");
  });

  // 4. URL-encodes a chat_id with special characters.
  it("URL-encodes the chat_id", () => {
    const url = larkDeepLink({ chat_id: "oc_test+chat/123" });
    expect(url).not.toMatch(/oc_test\+chat\/123/);
    expect(url).toContain("oc_test%2Bchat%2F123");
  });
});
