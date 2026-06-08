import { describe, it, expect } from "vitest";
import { larkDeepLink } from "../lib/larkDeepLink";

describe("larkDeepLink", () => {
  const CHAT_ID = "oc_testchat123";

  // 1. Returns message link when flag_message_id is present
  it("returns a message link URL when flag_message_id is present", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, flag_message_id: "om_abc123" });
    expect(url).toContain("message_link");
    expect(url).toContain("om_abc123");
  });

  // 2. Falls back to chat link when flag_message_id is undefined
  it("falls back to chat link when flag_message_id is undefined", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, flag_message_id: undefined });
    expect(url).not.toContain("message_link");
    expect(url).toContain(CHAT_ID);
  });

  // 3. Falls back to chat link when flag_message_id is null
  it("falls back to chat link when flag_message_id is null", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, flag_message_id: null });
    expect(url).not.toContain("message_link");
    expect(url).toContain(CHAT_ID);
  });

  // 4. Falls back to chat link when flag_message_id is empty string
  it("falls back to chat link when flag_message_id is empty string", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, flag_message_id: "" });
    expect(url).not.toContain("message_link");
    expect(url).toContain(CHAT_ID);
  });

  // 5. Message link uses applink.larksuite.com (NOT feishu.cn)
  it("message link uses applink.larksuite.com domain", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, flag_message_id: "om_abc123" });
    expect(url).toContain("applink.larksuite.com");
    expect(url).not.toContain("feishu.cn");
  });

  // 6. Chat link uses applink.larksuite.com (NOT feishu.cn)
  it("chat link uses applink.larksuite.com domain", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, flag_message_id: undefined });
    expect(url).toContain("applink.larksuite.com");
    expect(url).not.toContain("feishu.cn");
  });

  // 7. IDs are URL-encoded in the output
  it("URL-encodes a chat_id that contains special characters", () => {
    const specialChatId = "oc_test+chat/123";
    const url = larkDeepLink({ chat_id: specialChatId, flag_message_id: undefined });
    // Raw '+' and '/' should not appear unencoded
    expect(url).not.toMatch(/oc_test\+chat\/123/);
    // Encoded forms should be present
    expect(url).toMatch(/oc_test(%2B|\+)chat(%2F|\/)123/i);
  });
});
