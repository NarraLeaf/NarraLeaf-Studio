import { useMemo } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { StoryDocument } from "@shared/types/story";
import type { CharacterStoreDocument } from "@shared/characters/characterStoreModel";
import { storyDocumentSpec } from "@shared/documents/specs/story";
import { charactersSpec, CHARACTER_STORE_DOCUMENT_PATH } from "@shared/documents/specs/characters";
import { useTranslation } from "@/lib/i18n";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { resolveAssetDisplayName } from "@/lib/workspace/assets/assetDisplayName";
import { projectVariableNameLookup } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { buildDocumentChangeRows } from "../documentChangeView";
import { DOCUMENT_ROW_CEILING } from "../presenters/GenericChangeDetail";
import { sidesOfEntry } from "../presenters/entrySides";
import { useSideDocument, type SideDocument } from "../presenters/sideDocument";
import type { ComparisonSides } from "../presenters/comparisonSide";
import type { SplitContent } from "./SplitComparisonView";
import { renderStoryScriptSlot, type StoryScriptWords } from "./StoryScriptRow";
import {
    buildStoryScriptPlan,
    STORY_SCRIPT_BLOCK_CEILING,
    type StoryScriptSlot,
} from "./storyScriptPlan";

/**
 * A story comparison as two scripts rather than two lists of "row changed".
 *
 * The seam is the same one `useComparisonElements` uses for a page of the interface: the tab knows
 * the two versions, the hook reads the document at each of them, and what comes back is something
 * the shell can draw in both halves without learning what a story is.
 *
 * **Each half draws its own version's text.** Two reads, one per side, through the story document's
 * own spec - never the working tree's bytes for both, which is the substitution this whole surface
 * exists to remove. A side that does not hold the file at all (a story that was added, one that was
 * deleted) is not read, and its half is gaps.
 *
 * **It degrades to the list, silently.** If either side cannot be read, or the two versions between
 * them hold more lines than one tab may draw, this answers `undefined` and the shell falls back to
 * the change rows it drew before. That fallback says nothing about why, because there is nothing
 * true to say that the rows themselves do not already say.
 *
 * # Two kinds of name, read from two places
 *
 * A **speaker** is part of what the reader reads, so it is read at the version the half is showing -
 * the cast at that revision, through the character store's own spec. A comparison where an author
 * renamed a character has to show the old name on the left.
 *
 * An **asset's** or a **project variable's** name is not in the story at all: the story stores an id
 * and the name lives in a project-level table. Those are read LIVE, the way `useVersionedAssets`
 * reads the preview language live - it is a property of the person looking rather than of the
 * version being looked at, and there is no per-version read of them that a synchronous projection
 * could use. Where an id names nothing today the projection says so in its own words.
 */

export interface StoryScriptInput {
    readonly entry: DocumentDiffEntry | null;
    /** Repository-relative path of the story being compared. */
    readonly path: string;
    /** The two versions, or null before the comparison has answered. */
    readonly sides: ComparisonSides | null;
}

export function useStoryScript(input: StoryScriptInput): SplitContent | undefined {
    const { t } = useTranslation();
    const context = useOptionalWorkspace()?.context ?? null;

    const isStory = input.entry?.documentKind === "story";
    // `sidesOfEntry` answers null for the side a one-sided entry does not have, and `useSideDocument`
    // asks for nothing when it is given null - so a read that could only fail is never made.
    const requested = useMemo(
        () => (isStory && input.entry
            ? sidesOfEntry(input.entry, input.sides ?? undefined)
            : { before: null, after: null }),
        [isStory, input.entry, input.sides],
    );

    const baseStory = useSideDocument<StoryDocument>(requested.before, input.path, storyDocumentSpec);
    const headStory = useSideDocument<StoryDocument>(requested.after, input.path, storyDocumentSpec);
    const baseCast = useSideDocument<CharacterStoreDocument>(
        requested.before,
        CHARACTER_STORE_DOCUMENT_PATH,
        charactersSpec,
    );
    const headCast = useSideDocument<CharacterStoreDocument>(
        requested.after,
        CHARACTER_STORE_DOCUMENT_PATH,
        charactersSpec,
    );

    /**
     * The project-level tables, shared by both halves and read from the open project.
     *
     * Every one of them is wrapped, because a comparison pane renders in windows that carry only
     * part of the service set - and a missing table degrades one word of one row, which is not worth
     * a blank tab.
     */
    const projectLookups = useMemo<Pick<StoryRowLookups, "assetName" | "projectVariableName">>(() => {
        const services = context?.services ?? null;
        let projectVariableName: StoryRowLookups["projectVariableName"];
        try {
            const blueprints = services?.get<LocalBlueprintService>(Services.LocalBlueprint);
            if (blueprints) {
                projectVariableName = projectVariableNameLookup([
                    ...blueprints.listSavedVariables(),
                    ...blueprints.listPersistentVariables(),
                ]);
            }
        } catch {
            projectVariableName = undefined;
        }
        return {
            assetName: assetId => resolveAssetDisplayName(services, assetId),
            projectVariableName,
        };
    }, [context]);

    const words = useMemo<StoryScriptWords>(() => ({
        narrator: t("story.badge.narration"),
        unassigned: t("story.characterName.unassigned"),
        unnamedScene: t("story.describe.sceneUnknown"),
    }), [t]);

    const plan = useMemo(() => {
        if (!isStory || !input.entry) {
            return null;
        }
        if (!readable(requested.before, baseStory) || !readable(requested.after, headStory)) {
            return null;
        }
        // The same rows, and the same ceiling on them, that the shell would have drawn - so a change
        // reachable by previous and next before this surface existed is still reachable now.
        const rows = buildDocumentChangeRows(input.entry.diff, DOCUMENT_ROW_CEILING).rows;
        const built = buildStoryScriptPlan(rows, baseStory.document, headStory.document);
        return built.blocks > STORY_SCRIPT_BLOCK_CEILING ? null : built;
    }, [isStory, input.entry, requested, baseStory, headStory]);

    return useMemo(() => {
        if (!plan) {
            return undefined;
        }
        const documentOf = (side: "base" | "head") => (side === "base" ? baseStory.document : headStory.document);
        const shared = {
            base: { ...projectLookups, character: castLookup(baseCast) },
            head: { ...projectLookups, character: castLookup(headCast) },
        };
        return {
            slots: plan.slots,
            render: (slot, side, active) => renderStoryScriptSlot(
                // The shell holds a slot as presence and height and nothing else, which is what lets
                // it draw a change list and a script with one piece of arithmetic. Only this hook
                // puts slots into it, so only this hook can say what they are.
                slot as StoryScriptSlot,
                side,
                active,
                {
                    words,
                    lookupsFor: (half, sceneId) => ({
                        ...shared[half],
                        document: documentOf(half) ?? undefined,
                        scenes: documentOf(half)?.scenes,
                        // The scene at THIS version: a variable, a layer and a displayable reference
                        // all resolve against it, and resolving them against the other half's copy is
                        // how a row would quietly read as the wrong version.
                        scene: documentOf(half)?.scenes?.[sceneId],
                    }),
                },
            ),
        };
    }, [plan, projectLookups, baseCast, headCast, baseStory.document, headStory.document, words]);
}

/** A side is readable when it was not asked for at all, or when the read came back with a document. */
function readable(side: unknown, document: SideDocument<StoryDocument>): boolean {
    return side === null || document.status === "ready";
}

/**
 * The cast at one version, as the row projection's structural lookup.
 *
 * No colour: a character's accent may be a link into the project's brand palette, which would be a
 * second versioned document to read for one hue. Without it the disc and the nametag paint from the
 * name's own hash, which is the projection's documented fallback and still gives one character one
 * colour everywhere they appear.
 */
function castLookup(cast: SideDocument<CharacterStoreDocument>): StoryRowLookups["character"] {
    const store = cast.document;
    if (!store) {
        return () => null;
    }
    const names = new Map<string, string>();
    for (const entry of store.characters ?? []) {
        const profile = entry?.profile;
        if (profile?.id) {
            names.set(profile.id, profile.name ?? "");
        }
    }
    return characterId => {
        const name = names.get(characterId);
        return name === undefined ? null : { name };
    };
}
