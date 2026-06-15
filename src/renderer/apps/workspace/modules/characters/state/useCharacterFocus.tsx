import { useCallback, useState } from "react";
import { Character } from "@/lib/workspace/services/character/Character";
import { WorkspaceContext } from "@/lib/workspace/services/services";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { CharacterEditor } from "../editors/CharacterEditor";
import { User } from "lucide-react";

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

        uiService.editor.open({
            id: `narraleaf-studio:character-editor-${characterId}`,
            title: profile.name,
            icon: <User className="w-4 h-4" />,
            component: CharacterEditor,
            closable: true,
            payload: { character },
        }, undefined, { activate: true });

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

