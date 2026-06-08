import { describe, it, expect } from "vitest";
import { larkDeepLink, larkSearchSnippet } from "../lib/larkDeepLink";

describe("larkDeepLink", () => {
  const CHAT_ID = "oc_testchat123";

  it("builds a chat/open applink with the chat id", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID });
    expect(url).toContain("client/chat/open");
    expect(url).toContain(`openChatId=${CHAT_ID}`);
  });

  it("uses applink.larksuite.com and never message_link/thread/open or feishu.cn", () => {
    const url = larkDeepLink({ chat_id: CHAT_ID, applink: "ignored" });
    expect(url).toContain("applink.larksuite.com");
    expect(url).not.toContain("feishu.cn");
    expect(url).not.toContain("message_link");
    expect(url).not.toContain("client/thread/open");
  });

  it("URL-encodes the chat_id", () => {
    const url = larkDeepLink({ chat_id: "oc_test+chat/123" });
    expect(url).not.toMatch(/oc_test\+chat\/123/);
    expect(url).toContain("oc_test%2Bchat%2F123");
  });
});

describe("larkSearchSnippet", () => {
  it("returns empty string for empty/nullish input", () => {
    expect(larkSearchSnippet("")).toBe("");
    expect(larkSearchSnippet(undefined)).toBe("");
    expect(larkSearchSnippet(null)).toBe("");
  });

  it("collapses whitespace and newlines to single spaces", () => {
    expect(larkSearchSnippet("let me   ask\nthem  to\tclean up")).toBe(
      "let me ask them to clean up",
    );
  });

  it("strips leading mention/hash/emoji-ish noise", () => {
    expect(larkSearchSnippet("@Fajrin can you clean column F")).toBe(
      "Fajrin can you clean column F",
    );
  });

  it("returns the whole text when 8 words or fewer", () => {
    expect(larkSearchSnippet("let me ask them to clean up")).toBe(
      "let me ask them to clean up",
    );
  });

  it("caps long text to the first 8 words", () => {
    const long = "also data in column F is not standardized I see some variants here";
    expect(larkSearchSnippet(long)).toBe("also data in column F is not standardized");
  });
});
