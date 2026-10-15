import path from "path";
import { unpatchedFsPromises as fs } from "../../../utils/unpatchedFs";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { appIdCollisionKey } from "@shared/project/appIdSuggestion";
import { readProjectConfigFromDir } from "../utils/projectConfigFile";

/** One project on this machine, as far as its app ID goes. */
export type LocalAppId = {
    /** The ID as the project states it; empty for a project from before IDs were asked for. */
    appId: string;
    /** What it is compared by - see `appIdCollisionKey`. */
    key: string;
    /** The project's name, which is how the wizard names the project an ID belongs to. */
    projectName: string;
    projectPath: string;
};

/**
 * The app IDs of the projects this Studio knows on this machine.
 *
 * "Knows" is the projects it has met - `projectPaths`, which the caller fills from the recent list and
 * the trust ledger - and every project directly inside `folders`, which are the folders new projects
 * are being made in: a copy dropped into the projects folder has never been opened, and is exactly
 * the project a new one would collide with. One level deep, because that is where a project made in
 * a folder lands.
 *
 * A folder that is not there, a directory that holds no project, a config that will not read: each is
 * skipped. This answers "which IDs are taken", and a project it cannot read is one it cannot say
 * anything about.
 */
export async function listLocalAppIds(input: {
    projectPaths: Iterable<string>;
    folders: Iterable<string>;
}): Promise<LocalAppId[]> {
    const candidates = new Map<string, string>();
    const add = (projectPath: string) => {
        if (typeof projectPath !== "string" || !path.isAbsolute(projectPath)) {
            return;
        }
        const resolved = path.resolve(projectPath);
        const identity = normalizeProjectPath(resolved);
        if (identity && !candidates.has(identity)) {
            candidates.set(identity, resolved);
        }
    };
    for (const projectPath of input.projectPaths) {
        add(projectPath);
    }
    for (const folder of input.folders) {
        if (typeof folder !== "string" || !path.isAbsolute(folder)) {
            continue;
        }
        const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (entry.isDirectory()) {
                add(path.join(folder, entry.name));
            }
        }
    }

    const found = await Promise.all([...candidates.values()].map(async (projectPath): Promise<LocalAppId | null> => {
        try {
            const config: unknown = await readProjectConfigFromDir(projectPath);
            // A file that decodes to something other than a config is not a project's.
            if (typeof config !== "object" || config === null || Array.isArray(config)) {
                return null;
            }
            const { name, identifier } = config as { name?: unknown; identifier?: unknown };
            const projectName = typeof name === "string" && name.trim() ? name : path.basename(projectPath);
            const appId = typeof identifier === "string" ? identifier.trim() : "";
            return { appId, key: appIdCollisionKey(appId, projectName), projectName, projectPath };
        } catch {
            return null;
        }
    }));
    return found.filter((entry): entry is LocalAppId => entry !== null);
}
