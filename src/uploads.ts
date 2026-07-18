/**
 * Upload retention for the relay.
 *
 * Files sent via Telegram (PDFs, images) must outlive the message that
 * delivered them: follow-up questions ("explain this document") resume the
 * Claude session or re-read the file by path from conversation history.
 * Instead of unlinking right after the first analysis, uploads are kept and
 * swept by age on each new upload.
 */

import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export async function sweepOldUploads(
  dir: string,
  maxAgeMs: number
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (info.isFile() && info.mtimeMs < cutoff) {
        await unlink(path);
      }
    } catch {
      // File vanished or unreadable — skip
    }
  }
}
