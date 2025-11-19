import { Home } from "lucide-react";
import { EditorModule } from "../types";
import { WelcomeEditor } from "./WelcomeEditor";

/**
 * Welcome editor module
 * Displays the welcome screen when the workspace starts
 */
export const welcomeModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:welcome",
        title: "Welcome",
        icon: <Home className="w-4 h-4" />,
        closable: true,
    },
    component: WelcomeEditor,
};

