import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalObjectStorage, sha256Hex } from "@mnemosyne/storage-core";
import { describe, expect, it } from "vitest";

describe("storage-core", () => {
  it("stores, verifies, lists, reads, and deletes local objects", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnemosyne-storage-"));
    const storage = createLocalObjectStorage(root);
    const body = "sleep cue export";
    const expectedSha256 = sha256Hex(body);

    try {
      const stored = await storage.putObject({
        bucket: "export",
        key: "exports/user_demo/export.json",
        contentType: "application/json",
        body,
        ownerId: "user_demo",
        expectedSha256,
        metadata: { source: "unit_test" }
      });

      expect(stored.sha256).toBe(expectedSha256);
      expect(stored.manifest.size_bytes).toBe(Buffer.byteLength(body));
      expect(stored.manifest.metadata.storage_driver).toBe("local");

      const listed = await storage.listManifests({ ownerId: "user_demo" });
      expect(listed.map((manifest) => manifest.id)).toContain(stored.manifest.id);

      const read = await storage.getObject({ bucket: "export", key: "exports/user_demo/export.json" });
      expect(read?.manifest.sha256).toBe(expectedSha256);
      expect(Buffer.from(read?.body ?? []).toString("utf8")).toBe(body);

      const deleted = await storage.deleteObject({ bucket: "export", key: "exports/user_demo/export.json" });
      expect(deleted.deleted).toBe(true);
      expect(
        await storage.getObject({ bucket: "export", key: "exports/user_demo/export.json" })
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe keys and hash mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnemosyne-storage-"));
    const storage = createLocalObjectStorage(root);

    try {
      await expect(
        storage.putObject({
          bucket: "audio",
          key: "../escape.wav",
          contentType: "audio/wav",
          body: "escape"
        })
      ).rejects.toThrow("Unsafe object key");

      await expect(
        storage.putObject({
          bucket: "audio",
          key: "safe/demo.wav",
          contentType: "audio/wav",
          body: "demo",
          expectedSha256: "a".repeat(64)
        })
      ).rejects.toThrow("SHA-256 mismatch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
