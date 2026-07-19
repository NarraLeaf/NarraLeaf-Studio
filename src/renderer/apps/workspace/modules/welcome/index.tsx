import { Home } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../types";
import { WelcomeEditor } from "./WelcomeEditor";

/**
 * Welcome editor module
 * Displays the welcome screen when the workspace starts
 */
export const welcomeModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:welcome",
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.welcome",
        get title() {
            return translate("placeholders.moduleTitles.welcome");
        },
        icon: <Home className="w-4 h-4" />,
        closable: true,
    },
    component: WelcomeEditor,
};

