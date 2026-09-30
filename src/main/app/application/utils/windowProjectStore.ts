import path from "path";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import type { AppWindow } from "../managers/window/appWindow";
import { readProjectConfigFromDir } from "./projectConfigFile";
import { requireWindowProject } from "./windowProject";

/**
 * Which project's Dev Mode data a request reaches, as the stores name it.
 *
 * The saves, the screenshots and the persistence store all key their directory off one of two
 * things: the project's own `identifier` when its configuration has one, so that moving the folder
 * does not orphan an author's test saves, and its path otherwise.
 */
export type ProjectStoreRef = {
    projectPath: string;
    projectIdentifier?: string;
};

/**
 * The project's Dev Mode stores this request may touch - the window's own, found by the main process
 * rather than named by the caller.
 *
 * # Why asserting the path was not enough
 *
 * These requests used to carry `{ projectIdentifier?, projectPath }`, and the identifier WON: the
 * stores hash `id:<identifier>` when there is one and only fall back to the path. So a renderer that
 * reported its own path and somebody else's identifier landed on somebody else's saves, persistent
 * variables and screenshots, and an assertion on the path alone would have passed it. The identifier
 * is not a secret either - it is a field in a project file, and every build of the game carries it.
 *
 * So the caller no longer names one. The path is held against the window with
 * {@link requireWindowProject}, and the identifier is read here out of that project's own
 * configuration, which is where the renderer was getting it from in the first place: the Dev Mode
 * bundle carries the value the main process read off disk when it assembled the bundle, and the
 * workspace's reset reads the same field off the configuration it loaded.
 *
 * One consequence is deliberate. A Dev Mode window running a past revision used to store under that
 * revision's identifier, because its bundle was assembled from the snapshot; it now stores under the
 * project's current one, which is the store the workspace's "reset player data" has always cleared.
 *
 * # A configuration that cannot be read at this moment
 *
 * The configuration is rewritten while Dev Mode runs - a save of the project settings, the dependency
 * table - and a read that lands mid-write can fail to decode or find no file. Falling back to the path
 * then would quietly move the author's saves to another directory for one request, which is the one
 * outcome worse than failing it. So the last identifier read for this project stands in for a read
 * that failed, and a read that fails with nothing to stand in is a failed request rather than a guess.
 * A project whose configuration is simply absent, and was never read, keys off its path as before.
 */
export async function requireWindowProjectStore(
    window: AppWindow,
    named: { projectPath?: unknown } | null | undefined,
): Promise<ProjectStoreRef> {
    const projectPath = requireWindowProject(window, named?.projectPath as string);
    const projectIdentifier = await projectIdentifierOf(projectPath);
    return projectIdentifier ? { projectPath, projectIdentifier } : { projectPath };
}

/**
 * The identifier last read for each project root, keyed by the app's path identity.
 *
 * Only ever consulted when a fresh read fails - it is not a cache, and a successful read always wins,
 * so an author who changes the identifier is on the new one by the next request.
 */
const lastReadIdentifiers = new Map<string, string | null>();

/** Bounds the map; a handful of projects is the realistic ceiling, so dropping the lot is harmless. */
const MAX_REMEMBERED = 64;

/** Only for tests: the map is process-wide state, and one test must not colour the next. */
export function forgetProjectStoreIdentifiers(): void {
    lastReadIdentifiers.clear();
}

async function projectIdentifierOf(projectPath: string): Promise<string | undefined> {
    const key = normalizeProjectPath(path.resolve(projectPath));
    let config: ProjectConfigData | null = null;
    let failure: unknown = null;
    try {
        config = await readProjectConfigFromDir(projectPath);
    } catch (error) {
        failure = error;
    }
    if (config) {
        const identifier = typeof config.identifier === "string" && config.identifier.trim()
            ? config.identifier.trim()
            : null;
        if (lastReadIdentifiers.size >= MAX_REMEMBERED && !lastReadIdentifiers.has(key)) {
            lastReadIdentifiers.clear();
        }
        lastReadIdentifiers.set(key, identifier);
        return identifier ?? undefined;
    }
    if (lastReadIdentifiers.has(key)) {
        return lastReadIdentifiers.get(key) ?? undefined;
    }
    if (failure) {
        throw new Error(
            `The project configuration could not be read, so its Dev Mode data was not touched: ${
                failure instanceof Error ? failure.message : String(failure)
            }`,
        );
    }
    return undefined;
}
