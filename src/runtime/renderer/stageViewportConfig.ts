import {
    DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG,
    WEB_SHELL_VARIANT_META,
    type GameRuntimePackV1,
    type GameRuntimeViewportConfig,
} from "@shared/types/gameRuntime";
import type { StageCropAnchor, StageViewportFit } from "@/lib/ui-editor/runtime/app/StageViewportFrame";

/**
 * Whether this document was served by one of the mobile shells.
 *
 * `buildWebIndexHtml` stamps the meta only on the `mobile` variant. The desktop shell serves its own
 * document through a privileged protocol and the web export gets the plain one, so both answer false
 * — which is the whole point: cropping is a phone decision, and a desktop player resizing the window
 * would otherwise watch the game eat its own edges.
 */
export function isMobileShellDocument(): boolean {
    if (typeof document === "undefined") {
        return false;
    }
    const meta = document.querySelector(`meta[name="${WEB_SHELL_VARIANT_META}"]`);
    return meta?.getAttribute("content") === "mobile";
}

export type ResolvedStageViewport = {
    fit: StageViewportFit;
    cropAnchor: StageCropAnchor;
};

const LETTERBOXED: ResolvedStageViewport = {
    fit: "contain",
    cropAnchor: { x: "center", y: "center" },
};

/**
 * What the stage frame should do for this run.
 *
 * The crop applies on a phone and in a preview run — a preview exists to show the author what they
 * are shipping, so a preview that letterboxed while the phone cropped would be worse than no preview
 * at all. A packaged desktop or web build always letterboxes, whatever the project says, because the
 * player owns the window size there and no anchor can make cropping predictable.
 */
export function resolveStageViewport(input: {
    viewport?: GameRuntimeViewportConfig;
    mode: GameRuntimePackV1["mode"];
    isMobileShell: boolean;
}): ResolvedStageViewport {
    if (!input.isMobileShell && input.mode !== "preview") {
        return LETTERBOXED;
    }
    const config = input.viewport ?? DEFAULT_GAME_RUNTIME_VIEWPORT_CONFIG;
    return {
        fit: config.fit,
        cropAnchor: { x: config.cropAnchorX, y: config.cropAnchorY },
    };
}
