import { useCallback } from "react";
import type { TranslationKey } from "@shared/i18n/catalog";
import {
    collectStoryExpressionVariables,
    storyVariableRefKey,
    type StoryBlock,
    type StoryId,
    type StorySceneId,
    type StoryVariableRef,
} from "@shared/types/story";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { useRegistry } from "@/apps/workspace/registry";
import { blockReferenceSlots } from "@/lib/workspace/services/refactor/renameModel";
import { STORY_VARIABLES_PANEL_ID, storyVariableReveal } from "../story-variables/storyVariablesPanelId";
import { requestRename } from "./renameRequests";

/** More than this many variables on one row is a list, not a menu; the rest stay reachable from the panel. */
const MAX_VARIABLES = 3;

/** Every variable a row declares, reads or writes, in slot order, once each. */
export function storyRowVariables(block: StoryBlock): StoryVariableRef[] {
    const found: StoryVariableRef[] = [];
    const seen = new Set<string>();
    const add = (ref: StoryVariableRef) => {
        const key = storyVariableRefKey(ref);
        if (!seen.has(key)) {
            seen.add(key);
            found.push(ref);
        }
    };
    if (block.kind === "declaration") {
        add({ scope: block.payload.scope, variableId: block.id } as StoryVariableRef);
    }
    const { refs, expressions } = blockReferenceSlots(block);
    refs.forEach(slot => add(slot.ref));
    expressions.forEach(slot => collectStoryExpressionVariables(slot.expression.ast).forEach(add));
    return found;
}

/**
 * The rename refactor's entries on a story row's menu: rename and find the references of each
 * variable the row names, and rename a `/label` row. Empty for a row that names none.
 */
export function useStoryRowRefactorMenu(): (input: {
    block: StoryBlock | undefined;
    storyId: StoryId;
    sceneId: StorySceneId;
    variables: readonly { name: string; ref: StoryVariableRef }[];
    /** The freeze guard's menu-row props, for the entries that write. */
    writeRow: () => { disabled?: boolean };
}) => ContextMenuDef {
    const { t } = useTranslation();
    const { setPanelVisibility } = useRegistry();
    return useCallback(({ block, storyId, sceneId, variables, writeRow }) => {
        if (!block) {
            return [];
        }
        const items: ContextMenuDef = [];
        if (block.kind === "control" && block.payload.control === "label") {
            items.push({
                id: "refactor-rename-label",
                label: t("refactor.menu.renameLabel" as TranslationKey),
                ...writeRow(),
                onClick: () => requestRename({ kind: "label", storyId, sceneId, blockId: block.id }),
            });
        }
        const nameOf = (ref: StoryVariableRef) => {
            if (block.kind === "declaration" && block.id === ref.variableId) {
                return block.payload.name;
            }
            return variables.find(entry => storyVariableRefKey(entry.ref) === storyVariableRefKey(ref))?.name ?? null;
        };
        for (const ref of storyRowVariables(block).slice(0, MAX_VARIABLES)) {
            const name = nameOf(ref);
            if (!name) {
                // A ref nothing declares any more: there is no name to rename and the lint reports it.
                continue;
            }
            items.push(
                {
                    id: `refactor-rename-${storyVariableRefKey(ref)}`,
                    label: t("refactor.menu.renameVariable" as TranslationKey, { name }),
                    ...writeRow(),
                    onClick: () => requestRename({ kind: "variable", ref, storyId }),
                },
                {
                    id: `refactor-references-${storyVariableRefKey(ref)}`,
                    label: t("refactor.menu.findVariableReferences" as TranslationKey, { name }),
                    onClick: () => {
                        setPanelVisibility(STORY_VARIABLES_PANEL_ID, true);
                        storyVariableReveal.request({ scope: ref.scope, variableId: ref.variableId, references: true });
                    },
                },
            );
        }
        return items.length > 0 ? [{ id: "sep-refactor", separator: true }, ...items] : [];
    }, [t, setPanelVisibility]);
}
