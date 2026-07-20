import { describe, expect, it } from "vitest";
import {
  mergeUrlLists,
  originPatternsForUrls,
  parseUrlList,
} from "../../src/lib/bulk-import.js";

describe("bulk import input helpers", () => {
  it("parses, normalizes, and deduplicates HTTP URL lines", () => {
    const result = parseUrlList(`
      # Discord export
      https://cdn.discordapp.com/a.gif
      https://cdn.discordapp.com/a.gif
      http://example.com/b.gif
      nope
      file:///tmp/a.gif
    `);

    expect(result.urls).toEqual([
      "https://cdn.discordapp.com/a.gif",
      "http://example.com/b.gif",
    ]);
    expect(result.invalid).toEqual(["nope", "file:///tmp/a.gif"]);
  });

  it("merges sources in order and creates unique permission patterns", () => {
    const urls = mergeUrlLists(
      ["https://a.test/one.gif", "https://a.test/two.gif"],
      ["https://a.test/one.gif", "http://b.test/three.gif"],
    );

    expect(urls).toHaveLength(3);
    expect(originPatternsForUrls(urls)).toEqual([
      "https://a.test/*",
      "http://b.test/*",
    ]);
  });

  it("accepts same-line comma-separated URLs with spaces", () => {
    const result = parseUrlList(
      "https://example.com/one.gif, https://example.com/two.gif",
    );

    expect(result.urls).toEqual([
      "https://example.com/one.gif",
      "https://example.com/two.gif",
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("accepts same-line comma-separated URLs without spaces", () => {
    const result = parseUrlList(
      "https://example.com/one.gif,https://example.com/two.gif",
    );

    expect(result.urls).toEqual([
      "https://example.com/one.gif",
      "https://example.com/two.gif",
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("accepts mixed newline and comma separators", () => {
    const result = parseUrlList(
      "https://example.com/one.gif, https://example.com/two.gif\n" +
        "https://example.com/three.gif",
    );

    expect(result.urls).toEqual([
      "https://example.com/one.gif",
      "https://example.com/two.gif",
      "https://example.com/three.gif",
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("preserves commas inside URL paths and query values", () => {
    const result = parseUrlList(
      "https://example.com/cat,dog.gif?tags=one,two",
    );

    expect(result.urls).toEqual([
      "https://example.com/cat,dog.gif?tags=one,two",
    ]);
    expect(result.invalid).toEqual([]);
  });
});
