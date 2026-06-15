import { useEffect, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";

/** Bumps when uigraphs / blueprint document mutates (for editor refresh). */
export function useBlueprintDocumentRevision(): number {
    const { context, isInitialized } = useWorkspace();
    const [rev, setRev] = useState(0);

    useEffect(() => {
        if (!isInitialized || !context) {
            return;
        }
        const graph = context.services.get<UIGraphService>(Services.UIGraph);
        return graph.onGraphsChanged(() => {
            setRev(r => r + 1);
        });
    }, [context, isInitialized]);

    return rev;
}
