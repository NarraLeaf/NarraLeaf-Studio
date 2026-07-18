import { Keyboard } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { KeybindingsEditor } from "./KeybindingsEditor";
import { KEYBINDINGS_TAB_ID } from "./keybindingsTabId";

export function createKeybindingsTab(): EditorTabDefinition {
    return {
        id: KEYBINDINGS_TAB_ID,
        title: translate("placeholders.moduleTitles.keybindings"),
        icon: <Keyboard className="w-4 h-4" />,
        component: KeybindingsEditor,
        closable: true,
    };
}

/** Open the keyboard-shortcut settings tab, or focus it if it is already open. */
export function openKeybindingsTab(ctx: WorkspaceContext): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.open(createKeybindingsTab());
}
