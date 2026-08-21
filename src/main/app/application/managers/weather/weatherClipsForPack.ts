import path from "path";
import { Logger } from "@shared/utils/logger";
import type { StoryDocument, StoryLibraryIndex } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { Fs } from "@shared/utils/fs";
import { isValidStoryId } from "@shared/utils/storyId";
import { normalizeVfxConfiguration, type VfxConfiguration } from "@shared/types/vfx";
import { weatherBakeKey } from "@shared/weather/bakeKey";
import { collectWeatherSpecs, weatherClipAssetId, type PackedWeatherClip } from "@shared/weather/stage";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import type { WeatherBakeManager } from "./WeatherBakeManager";

const logger = new Logger("WeatherBake");

/**
 * Produce every weather clip a project's stories ask for, so the pack can carry them.
 *
 * ## Why this runs before the compile rather than inside it
 *
 * The story compiler runs inside the shipped game. By the time a `/vfx snow` row is compiled there
 * is no encoder to reach and no project to read - which is exactly why the clip has to be a file the
 * package already holds, addressed by an id the game can compute for itself.
 *
 * So the work is split at the only seam that can carry it: this produces the clips and hands the
 * packer a list; {@link weatherClipAssetId} is what makes the two ends agree on the name. Both sides
 * derive it from the same spec, so neither can ship a file the other will not ask for.
 *
 * ## Why it reads the project rather than the assembled bundle
 *
 * The bundle is assembled inside the compile worker, and a bake needs the main process (it spawns an
 * encoder). Reading the authored documents here answers the same question a row earlier: the clips a
 * variant does not ship are simply never copied, which costs a bake nobody watches rather than a
 * second pipeline for the same fact.
 *
 * Never throws. A clip that could not be produced is logged and left out, and the compile reports it
 * as a story diagnostic on the row that wanted it - a scene that plays without weather rather than a
 * build that refuses over an overlay.
 */
export async function bakeWeatherClipsForPack(
    manager: WeatherBakeManager,
    projectPath: string,
): Promise<PackedWeatherClip[]> {
    const uidoc = await readJson<UIDocument>(path.join(projectPath, "editor", "ui", "uidoc.json"));
    const specs = collectWeatherSpecs(
        await readStories(projectPath),
        uidoc ?? undefined,
        await readVfxConfiguration(projectPath),
    );
    if (specs.length === 0) {
        return [];
    }

    // `final`, and not from a setting. What this function produces is what a player receives, so the
    // one tier a preference could offer it is the one it must never use - and a preview is on this
    // path too, deliberately: a preview exists to show the author what they are about to ship.
    const outcome = await manager.ensure({
        projectRoot: projectPath,
        specs,
        priority: "blocking",
        quality: "final",
    });
    const clips: PackedWeatherClip[] = [];
    for (const spec of specs) {
        const key = weatherBakeKey(spec);
        const clipPath = outcome.paths.get(key);
        if (clipPath) {
            clips.push({ id: weatherClipAssetId(spec), path: clipPath });
        } else {
            logger.warn(`Weather clip ${key} was not produced, so this build carries no clip for it: ${outcome.failures.get(key) ?? "unknown reason"}`);
        }
    }
    return clips;
}

/**
 * Every story the project holds, read off disk.
 *
 * The authored documents rather than a folded bundle, for the same reason the variant preflight
 * reads them: a fold drops scenes, and a clip dropped here would be missing from a package that
 * still reaches the row.
 */
async function readStories(projectPath: string): Promise<StoryDocument[]> {
    const index = await readJson<StoryLibraryIndex>(path.join(projectPath, "editor", "story", "index.json"));
    const entries = Array.isArray(index?.stories) ? index.stories : [];
    const stories: StoryDocument[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        if (!isValidStoryId(entry.id) || seen.has(entry.id)) {
            continue;
        }
        seen.add(entry.id);
        const document = await readJson<StoryDocument>(
            path.join(projectPath, "editor", "story", "stories", entry.id, "storydoc.json"),
        );
        if (document?.id === entry.id) {
            stories.push(document);
        }
    }
    return stories;
}

/**
 * The frame rate this project bakes its screen effects at, read from the `.nlproj`.
 *
 * Read here rather than taken from the assembled bundle for the same reason the documents are: the
 * bundle is put together inside the compile worker, and this runs before it in the main process.
 * Both ends read the same file, which is what keeps the ids this produces and the ids the packer
 * narrows by from ever naming different clips.
 *
 * An unreadable project is the default rate rather than a refusal. The clips then baked are the
 * ones a project that never opened the setting asks for, which is what the packer will look for too.
 */
async function readVfxConfiguration(projectPath: string): Promise<VfxConfiguration> {
    try {
        const config = await readProjectConfigFromDir(projectPath);
        const app = config?.app && typeof config.app === "object" ? config.app as Record<string, unknown> : undefined;
        return normalizeVfxConfiguration(app?.vfx);
    } catch {
        return normalizeVfxConfiguration(undefined);
    }
}

/** Null for anything that is not there or will not parse: a project with no stories asks for no clips. */
async function readJson<T>(filePath: string): Promise<T | null> {
    const result = await Fs.read(filePath, "utf-8");
    if (!result.ok) {
        return null;
    }
    try {
        return JSON.parse(result.data) as T;
    } catch {
        return null;
    }
}
