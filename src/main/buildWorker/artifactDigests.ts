import { createHash } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";

/**
 * `SHA256SUMS` over everything a build produced.
 *
 * Written unconditionally, for every build, whatever platforms it targeted:
 * the file costs one pass over bytes that were just written and is the only
 * thing a player who downloaded a release can check without any tooling beyond
 * `sha256sum -c`. It is not a signature and does not pretend to be one - a
 * tampered download comes with a tampered sums file unless the GPG signature
 * beside it says otherwise.
 *
 * The format is `sha256sum`'s own so its `-c` mode reads the file as-is: two
 * spaces between digest and name (text mode), names relative to the directory
 * the file sits in, forward slashes on every platform, and a stable order that
 * does not depend on which target finished first.
 */

export const ARTIFACT_DIGEST_FILE_NAME = "SHA256SUMS";

export type ArtifactDigest = {
  /** Path relative to the output directory, forward slashes. */
  name: string;
  sha256: string;
};

/** The exact bytes of a `SHA256SUMS` file, digests already computed. */
export function formatArtifactDigests(entries: ArtifactDigest[]): string {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.name}\n`)
    .join("");
}

/** The name an artifact is listed under, relative to the output directory. */
export function artifactDigestName(artifact: string, outputDir: string): string {
  return path.relative(outputDir, artifact).split(path.sep).join("/");
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

type Log = (level: "info" | "warning" | "error", message: string) => void;

export type ArtifactDigestResult = {
  /** Absolute path of the written file, or null when nothing was hashable. */
  path: string | null;
  /**
   * The artifacts that went into it, absolute and deduplicated - i.e. every
   * artifact that is a regular file on disk. The GPG step signs exactly this
   * set, so the two never disagree about what "the artifacts" are.
   */
  files: string[];
};

/**
 * Write `SHA256SUMS` into the output directory.
 *
 * Directories are skipped rather than walked: the artifact that matters for a
 * `dir` target is the tree, and a digest per file inside it would drown the
 * installers everyone actually downloads. Detached signatures and any previous
 * sums file are skipped too, so re-running a build does not list a digest of
 * the digests.
 */
export async function writeArtifactDigests(
  artifacts: string[],
  outputDir: string,
  log: Log
): Promise<ArtifactDigestResult> {
  const seen = new Set<string>();
  const entries: ArtifactDigest[] = [];
  const files: string[] = [];
  for (const artifact of artifacts) {
    const resolved = path.resolve(artifact);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    const name = artifactDigestName(resolved, outputDir);
    if (name === ARTIFACT_DIGEST_FILE_NAME || name.endsWith(".asc")) {
      continue;
    }
    let stats;
    try {
      stats = await fs.stat(resolved);
    } catch {
      log("warning", `skipping ${name} in ${ARTIFACT_DIGEST_FILE_NAME}: it is no longer on disk`);
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    entries.push({ name, sha256: await sha256OfFile(resolved) });
    files.push(resolved);
  }
  if (entries.length === 0) {
    return { path: null, files };
  }
  const sumsPath = path.join(outputDir, ARTIFACT_DIGEST_FILE_NAME);
  await fs.writeFile(sumsPath, formatArtifactDigests(entries), "utf8");
  log(
    "info",
    `wrote ${ARTIFACT_DIGEST_FILE_NAME} (${entries.length} artifact${entries.length === 1 ? "" : "s"})`
  );
  return { path: sumsPath, files };
}
