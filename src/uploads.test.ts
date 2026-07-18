import { expect, test } from "bun:test";
import { mkdtemp, writeFile, utimes, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sweepOldUploads } from "./uploads";

test("removes uploads older than maxAgeMs, keeps recent ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "uploads-test-"));

  const oldFile = join(dir, "old.pdf");
  const newFile = join(dir, "new.pdf");
  await writeFile(oldFile, "old");
  await writeFile(newFile, "new");

  // Age the old file to 48h ago
  const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(oldFile, past, past);

  await sweepOldUploads(dir, 24 * 60 * 60 * 1000);

  const remaining = await readdir(dir);
  expect(remaining).toEqual(["new.pdf"]);
});

test("does nothing on a missing directory", async () => {
  await expect(
    sweepOldUploads("/nonexistent-dir-for-test", 1000)
  ).resolves.toBeUndefined();
});
