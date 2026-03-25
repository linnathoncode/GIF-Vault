import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  idbLog: vi.fn(),
}));

vi.mock("../../src/lib/db.js", () => ({
  idbLog: mocks.idbLog,
}));

describe("log sanitization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.idbLog.mockResolvedValue(undefined);
  });

  it("safeStringifyLogValue redacts query and hash in URL strings", async () => {
    const { safeStringifyLogValue } = await import("../../src/lib/log.js");
    const value = safeStringifyLogValue({
      url: "https://example.com/media.gif?token=abc123#keep-out",
    });

    expect(value).toContain("\"url\":\"https://example.com/media.gif?[REDACTED]#[REDACTED]\"");
    expect(value).not.toContain("token=abc123");
    expect(value).not.toContain("keep-out");
  });

  it("safeStringifyLogValue handles circular values", async () => {
    const { safeStringifyLogValue } = await import("../../src/lib/log.js");
    const details = { nested: {} };
    details.nested.self = details;

    const value = safeStringifyLogValue(details);
    expect(value).toContain("[Circular]");
  });

  it("safeLog stores sanitized details", async () => {
    const { safeLog } = await import("../../src/lib/log.js");

    await safeLog("import", "fetching", {
      sourceUrl: "https://example.com/post?auth=secret#hash",
    });

    expect(mocks.idbLog).toHaveBeenCalledTimes(1);
    expect(mocks.idbLog).toHaveBeenCalledWith("import", "fetching", {
      sourceUrl: "https://example.com/post?[REDACTED]#[REDACTED]",
    });
  });
});
