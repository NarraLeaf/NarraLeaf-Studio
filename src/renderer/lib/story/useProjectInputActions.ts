import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

/** One of the project's input actions, as a picker needs it. */
export type ProjectInputActionRef = { id: string; name: string };

/**
 * The project's input actions, live - what `/waitinput`, `/hold` and `/mash` wait for.
 *
 * The same wiring as {@link useProjectSurfaces}, for the same reason: an action renamed over in the
 * interface editor's input settings has to reach every row that names it without a reload.
 *
 * Empty before services are up, which reads as "no actions" - the same thing an author who has not
 * declared any would see.
 *
 * Comments in English per project convention.
 */
export function useProjectInputActions(): ProjectInputActionRef[] {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<UIDocumentService>(Services.UIDocument) : null),
        [context, isInitialized],
    );
    const [actions, setActions] = useState<ProjectInputActionRef[]>([]);

    useEffect(() => {
        if (!service) {
            setActions([]);
            return;
        }
        const read = (): ProjectInputActionRef[] =>
            Object.values(service.getDocument().actions ?? {}).map(action => ({ id: action.id, name: action.name }));
        setActions(read());
        return service.onDocumentChanged(() => setActions(read()));
    }, [service]);

    return actions;
}
