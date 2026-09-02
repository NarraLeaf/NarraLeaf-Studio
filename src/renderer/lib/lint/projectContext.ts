/**
 * A {@link LintContext} from plain project data, for a caller with no workspace behind it.
 *
 * `LintService.buildContext()` assembles the same value out of eleven services, which is why the
 * rules - every one of them a pure function of this context - could only be run by a running Studio.
 * The command-line tools have the documents already; this is the seam that lets them run the same
 * rules over them, so an author's static checks and an agent's are the same checks.
 *
 * ## What it cannot fill, and why that is stated rather than faked
 *
 * Two inputs come from machinery rather than from files: the asset REFERENCE index (built by
 * sweeping every document for ids) and the `io` probes (which decode image and video bytes). Neither
 * is available here, so both keep the refusing defaults, and {@link headlessLintCategories} names
 * the rule categories a caller may honestly run against a context built this way.
 *
 * Filling them with empty values instead would be worse than refusing: `assets/missing` looks for
 * references to ids the library no longer has, and an empty reference index makes it answer "none"
 * on every project - a rule that has quietly stopped working, reported as a pass.
 *
 * Comments in English per project convention.
 */

import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { buildMergedVariableView } from "@shared/variables/mergedPersistentView";
import { savedVariableDefs, storyPersistentDefs } from "@shared/types/story/declarations";
import type { LintCategory } from "./types";
import type { LintAssetEntry, LintCharacterEntry, LintContext, LintStoryEntry } from "./context";
import { createTestLintContext } from "./testContext";

/**
 * The categories whose rules read only what {@link buildProjectLintContext} can fill.
 *
 * `story` asks questions about the documents themselves - does this jump lead anywhere, is this
 * label declared twice, is this ending reachable - and the documents are exactly what a directory
 * holds. Every other category asks about asset bytes or about the reference index, and running one
 * against a context that has neither would report a pass it did not earn.
 */
export const headlessLintCategories: readonly LintCategory[] = ["story"];

export type ProjectLintInput = {
    stories: readonly LintStoryEntry[];
    blueprintDocument: BlueprintDocument | null;
    uiDocument: UIDocument | null;
    characters: readonly LintCharacterEntry[];
    assets: readonly LintAssetEntry[];
    appTags: readonly ProjectAppTag[];
    variableRegistry: readonly VariableRegistryEntry[];
};

export function buildProjectLintContext(input: ProjectLintInput): LintContext {
    const registryIn = (scope: "persistent" | "saved"): VariableRegistryEntry[] =>
        input.variableRegistry.filter(entry => entry.scope === scope);
    // Per scope, never over the whole registry: a saved `Gold` and a persistent `Gold` are two
    // variables in two namespaces, and merging them would report a collision that cannot happen.
    const persistentNameCollisions = buildMergedVariableView(
        registryIn("persistent"),
        input.stories.flatMap(story => Object.values(storyPersistentDefs(story.document))),
    ).nameCollisions;
    const savedNameCollisions = buildMergedVariableView(
        registryIn("saved"),
        input.stories.flatMap(story => Object.values(savedVariableDefs(story.document))),
    ).nameCollisions;

    return createTestLintContext({
        stories: input.stories,
        storiesComplete: true,
        blueprintDocument: input.blueprintDocument,
        uiDocument: input.uiDocument,
        characters: input.characters,
        assets: input.assets,
        // Every project has the release variant whether or not a document lists one, so a slot that
        // takes a variant is never empty.
        appTags: input.appTags.length > 0 ? input.appTags : [RELEASE_APP_TAG],
        variableRegistry: input.variableRegistry,
        persistentNameCollisions,
        savedNameCollisions,
        // Left as the refusing defaults on purpose - see the note at the top of this file.
        // Incomplete, and it says which slice is missing rather than which line of code is: a rule
        // reading this has to be able to tell an empty project from an unread one.
        assetIndex: {
            complete: false,
            gaps: [{ reason: "documentUnreadable", slice: "story", location: "no reference index outside Studio" }],
        },
    });
}
