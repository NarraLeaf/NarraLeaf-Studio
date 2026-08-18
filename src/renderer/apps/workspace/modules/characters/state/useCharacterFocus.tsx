import { useCallback, useState } from "react";
import { Character } from "@/lib/workspace/services/character/Character";
import { WorkspaceContext } from "@/lib/workspace/services/services";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type {
  EditorGroup,
  EditorLayout,
  EditorTabDefinition
} from "@/apps/workspace/registry/types";
import { CharacterEditor } from "../editors/CharacterEditor";
import { User } from "lucide-react";

/** One character, one editor tab — the id every open path and every close path agrees on. */
export function characterEditorTabId(characterId: string): string {
  return `narraleaf-studio:character-editor-${characterId}`;
}

function findTabInLayout(
  layout: EditorLayout | null | undefined,
  tabId: string
): { tab: EditorTabDefinition<unknown>; groupId: string } | null {
  if (!layout) {
    return null;
  }
  if ("tabs" in layout) {
    const group = layout as EditorGroup;
    const tab = group.tabs.find((candidate) => candidate.id === tabId);
    return tab ? { tab: tab as EditorTabDefinition<unknown>, groupId: group.id } : null;
  }
  return findTabInLayout(layout.first, tabId) ?? findTabInLayout(layout.second, tabId);
}

/**
 * Re-title an open character editor tab after a rename.
 *
 * The tab's title is a *snapshot* taken when it was opened — it has to be, because a tab definition
 * is a plain object the layout stores, not a live view of the character. So renaming a character
 * anywhere (the list's menu, the properties panel, the editor's own header) left the tab still
 * saying the old name until it was closed and reopened.
 *
 * Goes through the layout rather than `EditorService.update`, because that one writes the flat
 * legacy `editorTabs` list while what the tab strip renders comes from `editorLayout` — and a tab
 * dragged into a second group is not in the active group, so the group has to be located rather than
 * assumed. Re-opening with `activate: false` is the store's own in-place update path.
 */
export function syncCharacterEditorTabTitle(
  uiService: UIService,
  characterId: string,
  title: string
): void {
  const store = uiService.getStore();
  const found = findTabInLayout(store.getEditorLayout(), characterEditorTabId(characterId));
  if (!found || found.tab.title === title || !title) {
    return;
  }
  store.openEditorTabInGroup({ ...found.tab, title }, found.groupId, false);
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
export function useCharacterFocus({
  context,
  panelId
}: UseCharacterFocusParams): UseCharacterFocusResult {
  const [focusedCharacterId, setFocusedCharacterId] = useState<string | null>(null);

  const handleCharacterClick = useCallback(
    (character: Character) => {
      if (!context) return;

      const uiService = context.services.get<UIService>(Services.UI);
      const profile = character.profile.getProfile();
      const characterId = profile.id;

      uiService.getStore().setSelection({ type: "character", data: character });
      uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
      setFocusedCharacterId(characterId);

      uiService.editor.open(
        {
          id: characterEditorTabId(characterId),
          title: profile.name,
          icon: <User className="w-4 h-4" />,
          component: CharacterEditor,
          closable: true,
          payload: { character }
        },
        undefined,
        { activate: true }
      );

      // Return focus to the list so keyboard scope stays in the panel.
      uiService.focus.setFocus(FocusArea.LeftPanel, panelId, { silent: true });
      uiService.panels.show("narraleaf-studio:properties");
    },
    [context, panelId]
  );

  const setFocusToPanel = useCallback(() => {
    if (!context) return;
    const uiService = context.services.get<UIService>(Services.UI);
    uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
  }, [context, panelId]);

  return {
    focusedCharacterId,
    handleCharacterClick,
    setFocusToPanel
  };
}
