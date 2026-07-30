/**
 * `nl.video` is a Surface widget, not a stage element. The engine's `Video` is an `Actionable`
 * with no position and no transform - it plays over the whole screen. This one is a DOM `<video>`
 * inside the ordinary rectangle chrome, so it has a layout box, corner radius, a border and an
 * opacity like every other widget, and it never touches the engine's element model.
 */
export const UI_VIDEO_ELEMENT_TYPE = "nl.video";

/** Maps 1:1 onto the CSS `object-fit` values a `<video>` honors. */
export type UIVideoObjectFit = "contain" | "cover" | "fill" | "none";

export type UIVideoPreload = "none" | "metadata" | "auto";

export type UIVideoWidgetProps = {
    /**
     * Named `assetId` on purpose, not `videoAssetId`. `surfaceResourcePreload.ts` keys its preload
     * walk on that literal property name, so the shipped game preloads this asset with no per-widget
     * code. `referenceModel.ts` now matches the same two literal names (it previously only knew
     * `imageFill`, `fontAssetId`, and `nl.image`'s legacy bare id).
     */
    assetId: string | null;
    /** Optional still shown before playback starts; also what the paused editor canvas prefers. */
    posterAssetId: string | null;
    objectFit: UIVideoObjectFit;
    loop: boolean;
    muted: boolean;
    /** Runtime only. The editor canvas never autoplays - see `videoPreviewPlayback.ts`. */
    autoplay: boolean;
    /**
     * 0-1. Phase 2 drives this from a blueprint `volume` input pin so an author can wire
     * `Get BGM Volume` (etc.) into it; the widget deliberately does not read settings itself.
     */
    volume: number;
    playbackRate: number;
    /** Browser-native control strip. Off by default: most titles skin their own. */
    controls: boolean;
    preload: UIVideoPreload;
};

export const defaultVideoWidgetProps: UIVideoWidgetProps = {
    assetId: null,
    posterAssetId: null,
    objectFit: "contain",
    loop: false,
    muted: false,
    autoplay: false,
    volume: 1,
    playbackRate: 1,
    controls: false,
    preload: "metadata",
};

const OBJECT_FIT_VALUES: readonly UIVideoObjectFit[] = ["contain", "cover", "fill", "none"];
const PRELOAD_VALUES: readonly UIVideoPreload[] = ["none", "metadata", "auto"];

/**
 * Chromium's accepted `playbackRate` window. Outside it the assignment throws `NotSupportedError`,
 * which would take down the whole renderer effect rather than just play at the wrong speed.
 */
export const UI_VIDEO_MIN_PLAYBACK_RATE = 0.0625;
export const UI_VIDEO_MAX_PLAYBACK_RATE = 16;

function readAssetId(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, n));
}

export function normalizeVideoProps(raw: Record<string, unknown> | undefined): UIVideoWidgetProps {
    const base = defaultVideoWidgetProps;
    const objectFit = OBJECT_FIT_VALUES.find(value => value === raw?.objectFit) ?? base.objectFit;
    const preload = PRELOAD_VALUES.find(value => value === raw?.preload) ?? base.preload;
    return {
        assetId: readAssetId(raw?.assetId),
        posterAssetId: readAssetId(raw?.posterAssetId),
        objectFit,
        loop: readBoolean(raw?.loop, base.loop),
        muted: readBoolean(raw?.muted, base.muted),
        autoplay: readBoolean(raw?.autoplay, base.autoplay),
        volume: clampFinite(raw?.volume, 0, 1, base.volume),
        playbackRate: clampFinite(
            raw?.playbackRate,
            UI_VIDEO_MIN_PLAYBACK_RATE,
            UI_VIDEO_MAX_PLAYBACK_RATE,
            base.playbackRate,
        ),
        controls: readBoolean(raw?.controls, base.controls),
        preload,
    };
}
