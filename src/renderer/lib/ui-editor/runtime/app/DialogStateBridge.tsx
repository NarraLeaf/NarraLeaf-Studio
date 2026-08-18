import { useLayoutEffect } from "react";
import { useAvatar, useDialog } from "narraleaf-react";
import {
    BLUEPRINT_GAME_CHARACTERS_STATE_KEY,
    BLUEPRINT_GAME_NAMETAG_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_AVATAR_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY,
} from "@shared/types/blueprint/hostApi";
import { findBlueprintCharacterInfo } from "@shared/types/blueprint/characterInfo";
import { toBlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";

/**
 * Mirrors the NarraLeaf dialog state (speaker nametag, avatar and accent colour) into the blueprint
 * global scope and flushes dialog-bound elements whenever the dialog text,
 * speaker, or completion state changes. Must render inside <NlrDialog>.
 *
 * The avatar comes from the engine's own `useAvatar`, which resolves it off the speaking
 * character's *live* portrait element - so it already reflects the differential that character is
 * currently wearing, and it stays right through undo, load and skip. What the engine returns is a
 * URL (that is what an `<img>` takes); a blueprint pin carries an `ImageAsset`, so the compile's
 * own url→assetId inverse turns it back. A URL that inverse does not know resolves to no avatar
 * rather than to a guess.
 *
 * **A layout effect, not a passive one.** Widgets dispatch their own `init` from a layout effect
 * (`BlueprintWidgetInitLifecycle`), and a passive effect runs after every layout effect in the
 * commit - so on any remount of the dialog (a scene jump remounts it) the avatar widget asked
 * `Get Speaker Avatar` before this bridge had mirrored the line that was mounting, and answered
 * with the *previous* speaker. The corrective flush that follows cannot rescue it either: it is
 * dropped on the mounting commit, because `hostAdapterRef` belongs to the parent surface shell and
 * a child's effect runs before the parent has filled it in. The visible defect was the previous
 * speaker's face sitting on the first line of every new scene - narration included - until the
 * line finished typing.
 *
 * The accent colour is a Studio-side field the engine knows nothing about, so it is derived here
 * rather than reported: the host stages *who* is speaking (a character id, not the nametag - see
 * `BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY`) and mirrors the character table, and this bridge
 * joins the two on the dialog beat. Deriving it here rather than staging the colour itself is what
 * lets a narrator line blank the colour without losing who spoke last.
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

    useLayoutEffect(() => {
        if (!core) {
            return;
        }
        const nametag = dialog.isNarrator ? null : getCurrentNametag();
        const avatarAssetId = avatarSrc ? resolveAvatarAssetId?.(avatarSrc) ?? null : null;
        core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
        // The same write is the clock: `refreshAll` is key-agnostic, so mirroring the avatar here
        // re-evaluates every value graph on the same beat the nametag already did.
        core.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_AVATAR_STATE_KEY, toBlueprintImageAsset(avatarAssetId));
        // Same beat, same reason: a nametag widget that tints itself from the speaker colour has to
        // repaint with the line it belongs to, not one line late.
        const speakerId = dialog.isNarrator
            ? null
            : core.scopeBridge.globalGet(BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY);
        const speaker = typeof speakerId === "string"
            ? findBlueprintCharacterInfo(core.scopeBridge.globalGet(BLUEPRINT_GAME_CHARACTERS_STATE_KEY), speakerId)
            : null;
        core.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY, speaker?.color ?? null);
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
