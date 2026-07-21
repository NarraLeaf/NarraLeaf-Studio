import { Info } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../types";
import { AboutEditor } from "./AboutEditor";

/**
 * About editor module.
 *
 * A single static credits tab, opened from Help ▸ About. Only ever one instance is open at a
 * time (see `openAboutTab`).
 */
export const aboutModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:about",
        // Resolved lazily on read (module registration runs after i18n init), so the tab title
        // follows a live language switch instead of freezing in the startup locale.
        titleKey: "about.title",
        get title() {
            return translate("about.title");
        },
        icon: <Info className="w-4 h-4" />,
        closable: true,
    },
    component: AboutEditor,
};
