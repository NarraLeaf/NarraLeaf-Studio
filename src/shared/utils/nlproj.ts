import msgpack from "msgpack-lite";
import { transliterate } from "transliteration";
import type { ProjectDependencyTable } from "../types/pluginDependencies";
import { entryFileName } from "./fileEntry";
import { join } from "./path";

/**
 * Project config structure stored in .nlproj files.
 * Must match ProjectConfig from workspace project types.
 */
export interface ProjectConfigData {
    name: string;
    identifier: string;
    metadata: Record<string, unknown>;
    app?: Record<string, unknown>;
    dependencies?: ProjectDependencyTable;
}

/**
 * The project config file's extension.
 *
 * Exported because it is also the extension Studio registers with the operating system: a
 * double-clicked `.nlproj` is how a project is opened from outside Studio, and the launch path that
 * answers it has to recognise the same file this module writes.
 */
export const NLPROJ_EXT = ".nlproj";
const MAX_FILENAME_LENGTH = 100;

/**
 * Characters a file name may not hold on some system a project or a build travels to: the ones
 * Windows reserves, the separators, and the control characters.
 */
const UNSAFE_FILENAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/gu;
/**
 * Invisible formatting characters - zero-width joiners and spaces, byte-order marks, and the
 * bidirectional overrides that make a name display in a different order than it is spelled.
 */
const FORMAT_CHARACTERS = /\p{Cf}/gu;
/** Device names Windows refuses as a file name's stem, whatever extension follows. */
const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** UTF-8 length of one code point. */
function utf8Length(codePoint: number): number {
    return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8, cut between code points. */
function truncateUtf8(text: string, maxBytes: number): string {
    let bytes = 0;
    let end = 0;
    for (const character of text) {
        bytes += utf8Length(character.codePointAt(0) ?? 0);
        if (bytes > maxBytes) {
            break;
        }
        end += character.length;
    }
    return text.slice(0, end);
}

/**
 * A project's or a variant's name as a file name, in the script the author wrote it in.
 *
 * It names the `.nlproj` of a new project, an exported project package, and every artifact a build
 * writes: the installer, the archives, the disk image, the AppImage, the web export, the APK, the
 * AAB and the IPA. Every file system and packager those land on takes Unicode names - the game's
 * Windows executable and macOS application inside them were always named from the product name as
 * written - so nothing is transliterated. Transliteration reads every Han character as Mandarin,
 * which is right for a Chinese title and wrong for a Japanese one: it turned 放課後 into
 * `Fang-Ke-Hou`.
 *
 * What changes is only what a file system would refuse or a reader would misread: reserved and
 * control characters become `-`, whitespace becomes `-`, invisible formatting characters go, leading
 * and trailing dots and dashes go, and a Windows device name (`CON`, `LPT1`) gets a `_` so it stays
 * a file. The result is NFC-normalized, so a name typed on a Mac and one typed on Windows come out
 * the same, and bounded to 100 bytes of UTF-8, which leaves room for the version, platform and
 * extension within the 255 bytes Linux and macOS allow a name.
 *
 * Not for anything that has to be ASCII: see {@link legacyAsciiName}.
 */
export function sanitizeProjectFileName(name: string): string {
    const cleaned = name
        .normalize("NFC")
        .replace(FORMAT_CHARACTERS, "")
        .replace(UNSAFE_FILENAME_CHARACTERS, "-")
        .replace(/\s+/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
    const bounded = truncateUtf8(cleaned, MAX_FILENAME_LENGTH).replace(/[-.]+$/, "");
    if (!bounded) {
        return "project";
    }
    return bounded.replace(/^[^.]+/, stem => (WINDOWS_RESERVED_STEM.test(stem) ? `${stem}_` : stem));
}

/**
 * The ASCII spelling every name had before file names kept their own script: transliterated (Han
 * read as Mandarin pinyin, kana as romaji), path-unsafe characters replaced.
 *
 * Kept for exactly two identities that were derived from it and must not move from one Studio
 * version to the next: the app id of a project that has no identifier (`deriveGameAppId`), which
 * the players' save folder, the Android and iOS ids and the Windows installer's GUID hang on; and
 * the name of the packaged app (`gameRuntimeArtifactCompiler`), which the Windows install folder and
 * the Linux executable follow. Its output must not change, and it must not name anything an author
 * reads.
 */
export function legacyAsciiName(name: string): string {
    const transliterated = transliterate(name);
    return transliterated
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, MAX_FILENAME_LENGTH) || "project";
}

/**
 * Get the .nlproj filename for a project (e.g. "MyProject.nlproj").
 */
export function getProjectConfigFileName(name: string): string {
    return sanitizeProjectFileName(name) + NLPROJ_EXT;
}

/**
 * Encode project config to msgpack binary.
 */
export function encodeProjectConfig(config: ProjectConfigData): Uint8Array {
    const encoded = msgpack.encode(config);
    return encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
}

/**
 * Decode msgpack binary to project config.
 */
export function decodeProjectConfig(buffer: Uint8Array): ProjectConfigData {
    const decoded = msgpack.decode(buffer);
    return decoded as ProjectConfigData;
}

/**
 * A directory entry as a listing reports it - the filename arrives split into a stem plus a
 * separate extension (see {@link entryFileName}), which is why these finders match on `ext` and
 * reassemble before returning a filename.
 */
export interface DirEntry {
    name: string;
    ext: string | null;
    type: string;
}

/**
 * Find the primary .nlproj config filename from directory entries.
 * Returns the filename (e.g. "MyProject.nlproj") or null if not found.
 */
export function findNlprojConfigFileName(entries: DirEntry[]): string | null {
    const nlproj = entries.find(
        (e) => e.type === "file" && e.ext === NLPROJ_EXT
    );
    if (nlproj) {
        return entryFileName(nlproj);
    }
    return null;
}

/**
 * Find the project config filename among directory entries.
 *
 * One spelling, and deliberately: projects written before `.nlproj` kept their config in a
 * `project.json`, and that fallback is gone rather than merely unused. A directory holding one is
 * not a project this build opens, and saying so is better than opening it and writing a `.nlproj`
 * beside a file it will then ignore.
 *
 * Returns the filename (e.g. "MyProject.nlproj") or null if there is none.
 */
export function findProjectConfigFileName(entries: DirEntry[]): string | null {
    return findNlprojConfigFileName(entries);
}
