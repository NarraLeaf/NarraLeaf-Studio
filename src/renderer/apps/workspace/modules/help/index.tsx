import { CircleQuestionMark } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../types";
import { HelpEditor, type HelpEditorPayload } from "./HelpEditor";

export { HelpEditor } from "./HelpEditor";
export type { HelpEditorPayload } from "./HelpEditor";
// `openHelpTab` is deliberately NOT re-exported here: it imports this file for the module metadata,
// the way `openWelcomeTab` does, so re-exporting it would close the cycle. Import it by path.

/** The help browser's editor module. One tab, reopened rather than stacked (see `openHelpTab`). */
export const helpModule: EditorModule<HelpEditorPayload> = {
    metadata: {
        id: "narraleaf-studio:help",
        // Resolved lazily on read (module registration runs before i18n has necessarily settled).
        titleKey: "help.ui.title",
        get title() {
            return translate("help.ui.title");
        },
        icon: <CircleQuestionMark className="w-4 h-4" />,
        closable: true,
    },
    component: HelpEditor,
};
