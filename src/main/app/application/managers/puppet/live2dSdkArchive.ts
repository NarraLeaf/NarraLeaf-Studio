/**
 * Reading an author's Cubism SDK for Web archive.
 *
 * Studio never obtains this file — the author downloads it from live2d.com, which is where they accept
 * Live2D's licences, and hands Studio the path. Fetching it on their behalf would make Studio a
 * distributor of the SDK, which its own licence forbids for a source-available application.
 * So the archive arrives as untrusted input, and this module's whole job is to answer
 * "is this the thing, and where inside it are the parts" precisely enough that a wrong file produces a
 * sentence the author can act on rather than "invalid archive".
 *
 * Pure and electron-free so it can be tested against a synthetic archive.
 */

import {
  parseZipIndex,
  readEntryBytes,
  type ZipIndex,
  type ZipIndexEntry
} from "../../../../buildWorker/mobile/zipModel";

/** The file that identifies an SDK archive and states its version. */
const INFO_FILE = "cubism-info.yml";
/** The Core, minified. The unminified sibling is equivalent and deliberately not preferred. */
const CORE_FILE = "Core/live2dcubismcore.min.js";
const FRAMEWORK_SOURCE_DIR = "Framework/src/";
const SHADER_DIR = "Framework/Shaders/WebGL/";

/**
 * Where the parts of one archive are, by their full entry names.
 *
 * Resolved rather than assumed because the archive's top-level directory carries the SDK version
 * (`CubismSdkForWeb-5-r.5/`), so no prefix can be hard-coded — a hard-coded one would break on the
 * next release with an error blaming the author's file.
 */
export type Live2DSdkArchive = {
  /** The prefix every entry shares, including its trailing slash. Empty when entries sit at the root. */
  root: string;
  /** As stated by `cubism-info.yml`, or null when it does not say. Shown to the author, never parsed. */
  version: string | null;
  core: ZipIndexEntry;
  /** `Framework/src/**` — TypeScript, which is why the adapter has to be bundled rather than shipped. */
  framework: ReadonlyMap<string, ZipIndexEntry>;
  /** The 13 `.vert` / `.frag` sources, by basename. Keyed that way because that is all the loader's URL carries. */
  shaders: ReadonlyMap<string, ZipIndexEntry>;
  /** Every licence text in the archive, by its path relative to {@link root}. Copied beside the build. */
  licenses: ReadonlyMap<string, ZipIndexEntry>;
};

/** Zip stores forward slashes; normalise anyway so a hand-built archive cannot smuggle a `\`. */
function normalize(name: string): string {
  return name
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

/** Enough names to orient an author without pasting a 342-entry listing. */
const MAX_LISTED_ENTRIES = 16;

function describeTopLevel(index: ZipIndex): string {
  const names = new Set<string>();
  for (const entry of index.entries) {
    const normalized = normalize(entry.name);
    if (!normalized) {
      continue;
    }
    const separator = normalized.indexOf("/");
    names.add(separator === -1 ? normalized : `${normalized.slice(0, separator)}/`);
  }
  const listed = [...names].sort();
  const shown = listed.slice(0, MAX_LISTED_ENTRIES).join(", ");
  const suffix = listed.length > MAX_LISTED_ENTRIES ? `, … (${listed.length} in total)` : "";
  return shown ? `${shown}${suffix}` : "(nothing)";
}

/**
 * `version: 5-r.5` out of the info file.
 *
 * Deliberately a one-line regex rather than a YAML parse: the only thing wanted is a string to show
 * the author, and pulling in a parser to read one scalar would make a malformed comment somewhere else
 * in the file able to fail an otherwise good install.
 */
function readVersion(text: string): string | null {
  const match = /^[ \t]*version[ \t]*:[ \t]*(\S+)[ \t]*$/m.exec(text);
  return match ? match[1] : null;
}

/**
 * Locate and check the parts of an SDK archive.
 *
 * Throws with a sentence naming what was looked for and what the archive actually holds. Every failure
 * here is an author who picked the wrong file — the sample project, a Cubism *Editor* download, a
 * partially-extracted folder re-zipped — so the message is the whole of the recovery path.
 */
export function inspectLive2DSdkArchive(archive: Buffer): Live2DSdkArchive {
  let index: ZipIndex;
  try {
    index = parseZipIndex(archive);
  } catch (error) {
    throw new Error(
      "That file is not a readable .zip archive " +
        `(${error instanceof Error ? error.message : String(error)}). ` +
        "Choose the Cubism SDK for Web archive exactly as it downloaded, without extracting it."
    );
  }

  const files = new Map<string, ZipIndexEntry>();
  for (const entry of index.entries) {
    if (!entry.isDirectory) {
      files.set(normalize(entry.name), entry);
    }
  }

  // The info file is the anchor: it exists once, at the SDK root, in every release.
  let root: string | null = null;
  let infoEntry: ZipIndexEntry | null = null;
  for (const [name, entry] of files) {
    if (name === INFO_FILE || name.endsWith(`/${INFO_FILE}`)) {
      const candidate = name.slice(0, name.length - INFO_FILE.length);
      // Shallowest wins, so a nested copy cannot outrank the real root.
      if (root === null || candidate.length < root.length) {
        root = candidate;
        infoEntry = entry;
      }
    }
  }
  if (root === null || infoEntry === null) {
    throw new Error(
      `This archive has no ${INFO_FILE}, so it is not a Cubism SDK for Web package. ` +
        `Its top-level entries are: ${describeTopLevel(index)}.`
    );
  }

  const core = files.get(`${root}${CORE_FILE}`);
  if (!core) {
    throw new Error(
      `This archive has a ${INFO_FILE} but no ${CORE_FILE}. ` +
        "That is the Cubism Core, and the runtime cannot be built without it: " +
        "the SDK for Web archive contains it, the Cubism Editor download does not."
    );
  }

  const framework = new Map<string, ZipIndexEntry>();
  const shaders = new Map<string, ZipIndexEntry>();
  const licenses = new Map<string, ZipIndexEntry>();
  for (const [name, entry] of files) {
    if (!name.startsWith(root)) {
      continue;
    }
    const relative = name.slice(root.length);
    if (relative.startsWith(FRAMEWORK_SOURCE_DIR) && relative.endsWith(".ts")) {
      framework.set(relative.slice(FRAMEWORK_SOURCE_DIR.length), entry);
    } else if (relative.startsWith(SHADER_DIR) && /\.(vert|frag)$/.test(relative)) {
      shaders.set(relative.slice(SHADER_DIR.length), entry);
    } else if (/(^|\/)(LICENSE|NOTICE)[^/]*\.(md|txt)$/i.test(relative)) {
      licenses.set(relative, entry);
    }
  }

  if (framework.size === 0) {
    throw new Error(
      `This archive has no ${FRAMEWORK_SOURCE_DIR} sources. The Cubism Framework is what the ` +
        "runtime is built from, and it ships in the SDK for Web archive alongside Core/."
    );
  }
  if (shaders.size === 0) {
    throw new Error(
      `This archive has no shader sources under ${SHADER_DIR}. ` +
        "A runtime built without them compiles empty programs and draws nothing, so the install " +
        "stops here rather than producing one."
    );
  }

  return {
    root,
    version: readVersion(readEntryBytes(archive, infoEntry).toString("utf-8")),
    core,
    framework,
    shaders,
    licenses
  };
}

export function readArchiveEntry(archive: Buffer, entry: ZipIndexEntry): Buffer {
  return readEntryBytes(archive, entry);
}
