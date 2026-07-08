import msgpack from "msgpack-lite";
import { transliterate } from "transliteration";
import type { ProjectDependencyTable } from "../types/pluginDependencies";
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

const NLPROJ_EXT = ".nlproj";
const LEGACY_CONFIG_FILE = "project.json";
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
 * Legacy project.json path for backward compatibility.
 */
export function getLegacyProjectConfigPath(projectPath: string): string {
    return join(projectPath, LEGACY_CONFIG_FILE);
}

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
        return nlproj.name + (nlproj.ext || "");
    }
    return null;
}

/**
 * Find the legacy project.json config filename from directory entries.
 * Returns "project.json" or null if not found.
 */
export function findLegacyProjectConfigFileName(entries: DirEntry[]): string | null {
    const legacy = entries.find(
        (e) => e.type === "file" && e.name === "project" && e.ext === ".json"
    );
    if (legacy) {
        return legacy.name + (legacy.ext || "");
    }
    return null;
}

/**
 * Find project config filename from directory entries.
 * Priority: .nlproj first, then project.json.
 * Returns the filename (e.g. "MyProject.nlproj" or "project.json") or null if not found.
 */
export function findProjectConfigFileName(entries: DirEntry[]): string | null {
    return findNlprojConfigFileName(entries) ?? findLegacyProjectConfigFileName(entries);
}
