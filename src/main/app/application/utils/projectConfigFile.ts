import fs from "fs/promises";
import path from "path";
import { decodeProjectConfig, findProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";

/**
 * Read a project's config (`.nlproj` or legacy `project.json`) from its root
 * directory. Returns null when the directory has no recognizable config file.
 * Shared by the game pack compiler and plugin dependency checks.
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
    const configPath = path.join(projectPath, configFileName);
    if (configFileName.endsWith(".nlproj")) {
        return decodeProjectConfig(await fs.readFile(configPath));
    }
    const raw = await fs.readFile(configPath, "utf-8");
    try {
        return JSON.parse(raw) as ProjectConfigData;
    } catch (error) {
        throw new Error(`Invalid JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
