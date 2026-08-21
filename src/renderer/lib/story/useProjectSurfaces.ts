import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

/** One page of the project's interface, as a picker needs it. */
export type ProjectSurfaceRef = { id: string; name: string };

/**
 * The project's pages, live.
 *
 * One hook rather than a subscribe/unsubscribe pair per surface, for the reason
 * {@link useProjectAppTags} gives: every field that names a page has to follow a rename made over in
 * the interface editor without a reload, and copies of the wiring drift on which of them re-reads.
 *
 * Empty before services are up, which a picker renders as "no pages" - honest, and the same thing an
 * author with no pages yet would see.
 *
 * Comments in English per project convention.
 */
export function useProjectSurfaces(): ProjectSurfaceRef[] {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<UIDocumentService>(Services.UIDocument) : null),
        [context, isInitialized],
    );
    const [surfaces, setSurfaces] = useState<ProjectSurfaceRef[]>([]);

    useEffect(() => {
        if (!service) {
            setSurfaces([]);
            return;
        }
        const read = (): ProjectSurfaceRef[] =>
            (service.getDocument().surfaces ?? []).map(surface => ({ id: surface.id, name: surface.name }));
        setSurfaces(read());
        return service.onDocumentChanged(() => setSurfaces(read()));
    }, [service]);

    return surfaces;
}
