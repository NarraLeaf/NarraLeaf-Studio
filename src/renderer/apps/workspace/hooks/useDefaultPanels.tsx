import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { useRegistry, PanelPosition } from "../registry";
import { AssetsPanel } from "../panels";

/**
 * Hook to register default panels
 * This hook should be called once when the workspace initializes
 */
export function useDefaultPanels() {
    const { registerPanel } = useRegistry();

    useEffect(() => {
        // Register Assets panel on the left sidebar
        registerPanel({
            id: "assets",
            title: "Assets",
            icon: <FolderOpen className="w-4 h-4" />,
            position: PanelPosition.Left,
            component: AssetsPanel,
            defaultVisible: true,
            order: 0,
        });

        // TODO: Register more default panels here
        // Examples:
        // - Scene Hierarchy
        // - Project Structure
        // - Properties/Inspector
        // - Console/Output
        // - Timeline

        // Cleanup is handled automatically by the registry
    }, [registerPanel]);
}

