import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { weatherStageSize } from "@shared/weather/stage";

/**
 * The size of the stage this project's pictures are composed against, kept current.
 *
 * Subscribed rather than read once because the surface that states it and the surface that needs it
 * are both editable while the other is open: an author can resize the stage in the UI editor with a
 * story inspector docked beside it, and a preview still scaled to the old size would be a preview of
 * a composition the project no longer has.
 *
 * ## Why the snapshot is a string
 *
 * `useSyncExternalStore` compares snapshots by identity, so answering with a fresh `{ width, height }`
 * on every call would be an infinite render loop - the same trap `useProjectVfxFrameRate` next door
 * documents, and for the same reason: the stored document is rebuilt wholesale on every write, so
 * even the surface object's identity moves when something unrelated is saved. A string is equal to
 * itself, and the pair is rebuilt from it once per actual change.
 */
export function useProjectStageSize(): { width: number; height: number } {
    const { context } = useWorkspace();
    const uiDocument = context?.services.get<UIDocumentService>(Services.UIDocument) ?? null;

    const subscribe = useCallback(
        (onChange: () => void) => uiDocument?.onDocumentChanged(onChange) ?? (() => undefined),
        [uiDocument],
    );
    const getSnapshot = useCallback(() => {
        try {
            const size = weatherStageSize(uiDocument?.getDocument());
            return `${size.width}x${size.height}`;
        } catch {
            // A window whose document has not been read yet. The fallback is not a placeholder: it is
            // the same answer `weatherStageSize` gives for a project with no surfaces, so nothing
            // downstream has a second case to handle.
            return "1920x1080";
        }
    }, [uiDocument]);

    const key = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return useMemo(() => {
        const [width, height] = key.split("x").map(Number);
        return { width: width || 1920, height: height || 1080 };
    }, [key]);
}
