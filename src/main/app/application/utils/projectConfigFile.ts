import fs from "fs/promises";
import path from "path";
import { decodeProjectConfig, findProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";

/**
 * Read a project's config (`.nlproj`) from its root directory. Returns null when the directory has
 * no recognizable config file. Shared by the game pack compiler and plugin dependency checks.
 */
export async function readProjectConfigFromDir(projectPath: string): Promise<ProjectConfigData | null> {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const configFileName = findProjectConfigFileName(entries.map(entry => ({
        name: path.parse(entry.name).name,
        ext: path.extname(entry.name) || null,
        type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
    })));
    if (!configFileName) {
        return null;
    }
    return decodeProjectConfig(await fs.readFile(path.join(projectPath, configFileName)));
}
