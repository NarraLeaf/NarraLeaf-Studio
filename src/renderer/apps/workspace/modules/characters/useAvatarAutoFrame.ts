import { useCallback, useSyncExternalStore } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { translate } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import {
    AutoFrameBusyError,
    getAutoFrameRunState,
    runAutoFrame,
    subscribeAutoFrameRunState,
    type HeadFrameDetector,
} from "@/lib/workspace/services/character/avatarAutoFrame";

/** Loaded on the first press: onnxruntime-web is not part of opening the Characters panel. */
const detectHeadFrame: HeadFrameDetector = async layers =>
    (await import("@/lib/workspace/services/character/headDetector")).detectHeadFrame(layers);

/**
 * The two Auto-frame buttons: every character's dialog avatars from the Characters panel, and the
 * one differential beside its framing box. Both share one run at a time with the agent tool, so a
 * button reads `running` to grey itself while any of them is working.
 *
 * Neither is ever started by Studio itself: model framing is an author's request. The bake that runs
 * on its own keeps the silhouette heuristic.
 */
export function useAvatarAutoFrame(): {
    running: boolean;
    /** Frame every differential that has no framing of its own, with the console's bar up. */
    frameAll: () => Promise<void>;
    /** Frame one differential, replacing the framing it has. Resolves false when no head was found. */
    frameOne: (characterId: string, key: string) => Promise<boolean>;
} {
    const { context } = useWorkspace();
    const state = useSyncExternalStore(subscribeAutoFrameRunState, getAutoFrameRunState, getAutoFrameRunState);

    const notify = useCallback((message: string, type: "warning" | "error") => {
        try {
            context?.services.get<UIService>(Services.UI).showNotification(message, type);
        } catch {
            // No UI service in this context.
        }
    }, [context]);

    const frameAll = useCallback(async () => {
        if (!context) return;
        try {
            await runAutoFrame(context, { overwrite: false, detect: detectHeadFrame, reveal: true });
        } catch (error) {
            if (error instanceof AutoFrameBusyError) return;
            notify(translate("characters.autoFrame.failed", { message: error instanceof Error ? error.message : String(error) }), "error");
        }
    }, [context, notify]);

    const frameOne = useCallback(async (characterId: string, key: string) => {
        if (!context) return false;
        try {
            const report = await runAutoFrame(context, { characterIds: [characterId], keys: [key], overwrite: true, detect: detectHeadFrame });
            const found = report.framed > 0;
            if (!found) {
                notify(translate("characters.autoFrame.noHead"), "warning");
            }
            return found;
        } catch (error) {
            if (!(error instanceof AutoFrameBusyError)) {
                notify(translate("characters.autoFrame.failed", { message: error instanceof Error ? error.message : String(error) }), "error");
            }
            return false;
        }
    }, [context, notify]);

    return { running: state.running, frameAll, frameOne };
}
