import path from "path";
import { collectBlueprintNodeSites, collectBlueprintNodeSitesIn } from "@shared/blueprint/blueprintNodeSites";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import {
    BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS,
    BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS,
} from "@shared/types/blueprint/graph";
import type { BuildPreflightFinding, GameBuildPlatform } from "@shared/types/gameBuild";
import { isMobileBuildPlatform } from "@shared/types/gameBuild";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { Fs } from "@shared/utils/fs";
import { loadSharedBlueprints } from "../devMode/pipeline/bundleAssembler";

/**
 * Targets whose shell cannot carry a playthrough from one edition of a title to the next.
 *
 * Export/Import Progress write one plain document per title, outside either edition's user-data
 * directory (`@shared/types/gameProgress`). A page has no such place, so the web shell's bridge
 * refuses - and the mobile shells serve the very same static site the web target exports, which is
 * why they are on this list rather than beside the desktop shells.
 *
 * Comments in English per project convention.
 */
function refusesProgressCarry(platform: GameBuildPlatform): boolean {
    return platform === "web" || isMobileBuildPlatform(platform);
}

const PROGRESS_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS,
    BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS,
]);

export type ProgressCarryPreflightInput = {
    projectPath: string;
    /** The platforms this build was asked for, in request order. */
    platforms: readonly GameBuildPlatform[];
};

/**
 * A warning per target that will refuse the progress nodes this project uses.
 *
 * A warning rather than an error, and stated here rather than as a gate, because both halves of the
 * situation are legitimate: an author who ships a demo on desktop and the full game on the web has
 * every reason to keep the nodes in the graph, and the refusal the runtime gives is one the graph
 * can already hear on its `Failed` branch. What they must not do is discover it from a player.
 *
 * Named per platform because that is the thing the author can change - dropping the web target, or
 * accepting it - and per blueprint because that is the file they open to look.
 *
 * Reads nothing when the build has no such target, which keeps every desktop build off this path.
 */
export async function collectProgressCarryFindings(
    input: ProgressCarryPreflightInput,
): Promise<BuildPreflightFinding[]> {
    const refusing = [...new Set(input.platforms.filter(refusesProgressCarry))];
    if (refusing.length === 0) {
        return [];
    }
    const blueprints = await readProgressNodeBlueprints(input.projectPath);
    if (blueprints.length === 0) {
        return [];
    }
    return refusing.map(platform => ({
        code: "progress-carry-unsupported" as const,
        severity: "warning" as const,
        section: "content" as const,
        detail: { platform, blueprints: blueprints.join(", ") },
    }));
}

/**
 * Distinct names of the blueprints holding a progress node, document and shared assets alike.
 *
 * The shared assets are half the answer, not a nicety: a title screen's "continue" button is exactly
 * the kind of graph an author factors out into a shared blueprint, and a check that read only
 * `uigraphs.json` would go quiet on the projects most likely to be affected.
 */
async function readProgressNodeBlueprints(projectPath: string): Promise<string[]> {
    const names = new Set<string>();
    const uigraphsPath = path.join(projectPath, "editor", "ui", "uigraphs.json");
    const raw = await Fs.read(uigraphsPath, "utf-8");
    if (raw.ok) {
        try {
            const document = JSON.parse(raw.data) as UIGraphDocument;
            const sites = collectBlueprintNodeSites(
                migrateBlueprintDocumentToLatest(document.blueprintDocument),
                PROGRESS_NODE_TYPES,
            );
            for (const site of sites) {
                names.add(site.blueprintName);
            }
        } catch {
            // A document that will not parse is the packer's to report; a dialog that warned on the
            // strength of a file it never read would be warning about a question it never asked.
        }
    }
    for (const asset of await loadSharedBlueprints(projectPath)) {
        if (collectBlueprintNodeSitesIn(asset.blueprint, PROGRESS_NODE_TYPES).length > 0) {
            names.add(asset.name || asset.blueprint.name || asset.assetId);
        }
    }
    return [...names];
}
