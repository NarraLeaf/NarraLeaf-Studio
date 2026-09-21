import { useEffect, useState } from "react";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { Services } from "@/lib/workspace/services/services";
import type { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import type { AssetNameGap } from "@/lib/workspace/services/references/assetNameGaps";

const NO_GAPS: readonly AssetNameGap[] = [];

/**
 * The project's asset-name gaps, as the reference index last computed them, kept live.
 *
 * The canvas marks a node from this rather than from its own reading of the graph, so what it marks
 * is exactly what the build refuses. The index rebuilds a moment after an edit, which is soon enough
 * for the mark to appear as the wire lands. A new array only when the answer changed: every slice of
 * the index announces its rebuilds, and most of them change nothing here.
 */
export function useAssetNameGaps(context: WorkspaceContext | null | undefined): readonly AssetNameGap[] {
    const [gaps, setGaps] = useState<readonly AssetNameGap[]>(NO_GAPS);
    useEffect(() => {
        if (!context) {
            return;
        }
        let references: ReferenceService;
        try {
            references = context.services.get<ReferenceService>(Services.Reference);
        } catch {
            return;
        }
        let mounted = true;
        let signature = "";
        const refresh = () => {
            if (!mounted) {
                return;
            }
            const next = references.getAssetNameGaps();
            const nextSignature = JSON.stringify(next);
            if (nextSignature !== signature) {
                signature = nextSignature;
                setGaps(next.length === 0 ? NO_GAPS : next);
            }
        };
        const unsubscribe = references.onIndexChanged(refresh);
        references.ensureReady().then(refresh, () => undefined);
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [context]);
    return gaps;
}
