/**
 * ZIP creation. `archiver` is the one non-repo dependency this feature adds:
 * Node has no built-in archive writer, and shelling out to `zip`/
 * `Compress-Archive` would make the two required npm scripts behave
 * differently (or fail outright) on Windows vs Linux CI. `archiver` is pure
 * JS, has no native build step, and is the de-facto standard for this in the
 * Node ecosystem.
 */
import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";

/**
 * @param {string} destZipPath absolute path to write the ZIP to
 * @param {{ arcPath: string, absPath?: string, content?: string }[]} entries
 *   either a file on disk (absPath) or in-memory generated content (content)
 */
export function createZip(destZipPath, entries) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);

    archive.pipe(output);
    for (const entry of entries) {
      if (entry.content !== undefined) {
        archive.append(entry.content, { name: entry.arcPath });
      } else {
        archive.file(entry.absPath, { name: entry.arcPath });
      }
    }
    archive.finalize();
  });
}
