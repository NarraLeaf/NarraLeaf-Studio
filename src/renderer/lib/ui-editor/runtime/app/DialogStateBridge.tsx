import { useEffect } from "react";
import { useAvatar, useDialog } from "narraleaf-react";
import {
    BLUEPRINT_GAME_NAMETAG_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_AVATAR_STATE_KEY,
} from "@shared/types/blueprint/hostApi";
import { toBlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";

/**
 * Mirrors the NarraLeaf dialog state (speaker nametag and avatar) into the blueprint
 * global scope and flushes dialog-bound elements whenever the dialog text,
 * speaker, or completion state changes. Must render inside <NlrDialog>.
 *
 * The avatar comes from the engine's own `useAvatar`, which resolves it off the speaking
 * character's *live* portrait element - so it already reflects the differential that character is
 * currently wearing, and it stays right through undo, load and skip. What the engine returns is a
 * URL (that is what an `<img>` takes); a blueprint pin carries an `ImageAsset`, so the compile's
 * own url→assetId inverse turns it back. A URL that inverse does not know resolves to no avatar
 * rather than to a guess.
 */
export function DialogStateBridge(props: {
    core: BlueprintRuntimeCore | null;
    getCurrentNametag: () => string | null;
    resolveAvatarAssetId?: (url: string) => string | null;
    flushDialogElements: () => void;
}) {
    const { core, getCurrentNametag, resolveAvatarAssetId, flushDialogElements } = props;
    const dialog = useDialog();
    const avatar = useAvatar();
    const avatarSrc = avatar.visible ? avatar.src : null;

    useEffect(() => {
        if (!core) {
            return;
        }
        const nametag = dialog.isNarrator ? null : getCurrentNametag();
        const avatarAssetId = avatarSrc ? resolveAvatarAssetId?.(avatarSrc) ?? null : null;
        core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
        // The same write is the clock: `refreshAll` is key-agnostic, so mirroring the avatar here
        // re-evaluates every value graph on the same beat the nametag already did.
        core.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_AVATAR_STATE_KEY, toBlueprintImageAsset(avatarAssetId));
        flushDialogElements();
    }, [
        core,
        dialog.done,
        dialog.isNarrator,
        dialog.text,
        avatarSrc,
        resolveAvatarAssetId,
        flushDialogElements,
        getCurrentNametag,
    ]);

    return null;
}
