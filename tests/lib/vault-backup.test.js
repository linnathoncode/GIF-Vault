import { describe, expect, it } from "vitest";
import { createVaultBackup, parseVaultBackup } from "../../src/lib/vault-backup.js";

describe("vault backup format", () => {
  it("round-trips media bytes and vault metadata", async () => {
    const blob = new Blob([new Uint8Array([71, 73, 70, 56])], { type: "image/gif" });
    const backup = await createVaultBackup(
      [{ id: "gif-1", name: "wave.gif", favorite: true, savedAt: 42 }],
      new Map([["gif-1", blob]]),
    );

    const items = parseVaultBackup(backup);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "gif-1",
      name: "wave.gif",
      favorite: true,
      mimeType: "image/gif",
      savedAt: 42,
    });
    expect([...new Uint8Array(await items[0].blob.arrayBuffer())]).toEqual([71, 73, 70, 56]);
  });

  it("rejects malformed, unsupported, and duplicate records before restore", () => {
    expect(() => parseVaultBackup("not json")).toThrow("valid GIF Vault backup");
    expect(() => parseVaultBackup(JSON.stringify({ format: "else", version: 1, items: [] }))).toThrow("supported GIF Vault backup");
    expect(() => parseVaultBackup(JSON.stringify({
      format: "gif-vault-backup",
      version: 1,
      items: [
        { metadata: { id: "same", mimeType: "image/gif" }, data: "R0lG" },
        { metadata: { id: "same", mimeType: "image/gif" }, data: "R0lG" },
      ],
    }))).toThrow("invalid or duplicate media");
  });
});
