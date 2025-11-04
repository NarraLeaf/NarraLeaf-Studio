import { useEffect } from "react";
import { Home } from "lucide-react";
import { useRegistry } from "../registry";
import { WelcomeEditor } from "../editors";

/**
 * Hook to open default editors when workspace initializes
 */
export function useDefaultEditors() {
    const { openEditorTab, editorLayout } = useRegistry();

    useEffect(() => {
        // Check if no tabs are open
        if ("tabs" in editorLayout && editorLayout.tabs.length === 0) {
            // Open welcome tab by default
            openEditorTab({
                id: "welcome",
                title: "Welcome",
                icon: <Home className="w-4 h-4" />,
                component: WelcomeEditor,
                closable: true,
            });
        }
    }, []);
}

