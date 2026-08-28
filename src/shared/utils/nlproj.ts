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
 * Sanitize project name for use as filename.
 * Uses transliteration and removes path-unsafe characters.
 */
export function sanitizeProjectFileName(name: string): string {
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
