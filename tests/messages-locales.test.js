import { describe, expect, it } from "vitest";
import { getMessagesForLocale } from "../src/lib/messages.js";

function collectLeafEntries(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value !== "function"
    ) {
      return collectLeafEntries(value, path);
    }
    return [{ path, value }];
  });
}

function collectStringEntries(node, prefix = "") {
  return collectLeafEntries(node, prefix).filter(
    (entry) => typeof entry.value === "string",
  );
}

describe("message locale consistency", () => {
  it("keeps EN and TR message keys/types in sync", () => {
    const en = getMessagesForLocale("en");
    const tr = getMessagesForLocale("tr");
    const enEntries = collectLeafEntries(en);
    const trEntries = collectLeafEntries(tr);

    const enMap = new Map(
      enEntries.map(({ path, value }) => [
        path,
        { type: typeof value, arity: typeof value === "function" ? value.length : 0 },
      ]),
    );
    const trMap = new Map(
      trEntries.map(({ path, value }) => [
        path,
        { type: typeof value, arity: typeof value === "function" ? value.length : 0 },
      ]),
    );

    expect([...enMap.keys()].sort()).toEqual([...trMap.keys()].sort());

    for (const [path, enMeta] of enMap) {
      const trMeta = trMap.get(path);
      expect(trMeta, `Missing TR key: ${path}`).toBeTruthy();
      expect(trMeta.type, `Type mismatch at ${path}`).toBe(enMeta.type);
      expect(trMeta.arity, `Function arity mismatch at ${path}`).toBe(
        enMeta.arity,
      );
    }
  });

  it("avoids accidental whitespace artifacts in user-facing strings", () => {
    const locales = ["en", "tr"];
    for (const locale of locales) {
      const messages = getMessagesForLocale(locale);
      for (const { path, value } of collectStringEntries(messages)) {
        expect(
          value,
          `Trailing whitespace in ${locale}:${path}`,
        ).not.toMatch(/[ \t]+\n|\n[ \t]+\n|[ \t]+$/);
        expect(
          value,
          `Leading whitespace after newline in ${locale}:${path}`,
        ).not.toMatch(/\n[ \t]+[^\n]/);
      }
    }
  });
});

