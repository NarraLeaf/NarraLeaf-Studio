import { useCallback, useState } from "react";
import { Character } from "@/lib/workspace/services/character/Character";
import { WorkspaceContext } from "@/lib/workspace/services/services";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { syncEditorTabTitle } from "@/lib/workspace/services/ui/editorTabTitle";
import { CharacterEditor } from "../editors/CharacterEditor";
import { User } from "lucide-react";

/** One character, one editor tab — the id every open path and every close path agrees on. */
export function characterEditorTabId(characterId: string): string {
    return `narraleaf-studio:character-editor-${characterId}`;
}

/**
 * The editor tab for one character, as every path that opens one builds it.
 *
 * A factory beside the id for the same reason `createStorySceneEditorTab` is one: opening a character
 * is no longer only "click it in the panel". A search hit, a lint finding, an asset's reference list
 * and a name on a story row all open the same tab now, and a tab definition copied per call site is a
 * title, an icon or a `closable` that drifts between the ways in.
 *
 * The title is a SNAPSHOT of the name, which is why {@link syncCharacterEditorTabTitle} exists.
 */
export function createCharacterEditorTab(character: Character): EditorTabDefinition<{ character: Character }> {
    const profile = character.profile.getProfile();
    return {
        id: characterEditorTabId(profile.id),
        title: profile.name,
        icon: <User className="w-4 h-4" />,
        component: CharacterEditor,
        closable: true,
        payload: { character },
    };
}

/**
 * Re-title an open character editor tab after a rename.
 *
 * A thin naming of {@link syncEditorTabTitle} - the general seam this case was the first to need.
 * See it for why the layout is written rather than `EditorService.update`.
 */
export function syncCharacterEditorTabTitle(uiService: UIService, characterId: string, title: string): void {
    syncEditorTabTitle(uiService, characterEditorTabId(characterId), title);
}

type UseCharacterFocusParams = {
    context: WorkspaceContext | null;
    panelId: string;
};

type UseCharacterFocusResult = {
    focusedCharacterId: string | null;
    handleCharacterClick: (character: Character) => void;
    setFocusToPanel: () => void;
};

// Manage focus and editor opening for characters.
export function useCharacterFocus({ context, panelId }: UseCharacterFocusParams): UseCharacterFocusResult {
    const [focusedCharacterId, setFocusedCharacterId] = useState<string | null>(null);

    const handleCharacterClick = useCallback((character: Character) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const profile = character.profile.getProfile();
        const characterId = profile.id;

        uiService.getStore().setSelection({ type: "character", data: character });
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
        setFocusedCharacterId(characterId);

        uiService.editor.open(createCharacterEditorTab(character), undefined, { activate: true });

        // Return focus to the list so keyboard scope stays in the panel.
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId, { silent: true });
        uiService.panels.show("narraleaf-studio:properties");
    }, [context, panelId]);

    const setFocusToPanel = useCallback(() => {
        if (!context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
    }, [context, panelId]);

    return {
        focusedCharacterId,
        handleCharacterClick,
        setFocusToPanel,
    };
}

