import { Keyboard } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../types";
import { KeybindingsEditor } from "./KeybindingsEditor";
import { KEYBINDINGS_TAB_ID } from "./keybindingsTabId";

/**
 * Keyboard-shortcut settings editor tab. Lives in the workspace (not the Settings window)
 * because the binding registry it edits only exists here.
 */
export const keybindingsModule: EditorModule = {
    metadata: {
        id: KEYBINDINGS_TAB_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.keybindings",
        get title() {
            return translate("placeholders.moduleTitles.keybindings");
        },
        icon: <Keyboard className="w-4 h-4" />,
        closable: true,
    },
    component: KeybindingsEditor,
};

export { openKeybindingsTab, createKeybindingsTab } from "./openKeybindingsTab";
export { KEYBINDINGS_TAB_ID } from "./keybindingsTabId";
