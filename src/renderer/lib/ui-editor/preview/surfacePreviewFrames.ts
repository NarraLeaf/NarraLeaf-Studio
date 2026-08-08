/**
 * Pure geometry for the UI Surface editor's preview overlays.
 *
 * The engine letterboxes on every run path (`computeStageViewportMetrics`: `fit = min(W/dw, H/dh)`,
 * centred, aspect preserved), so nothing is ever cropped. These frames therefore do NOT show "what
 * gets cut off". They show two independent things:
 *
 * 1. **Screen-ratio frame** — where the letterbox / pillarbox bars land around the design rect on a
 *    player screen of a given aspect ratio.
 * 2. **Safe-area frame** — how far a device's notch / home indicator / gesture bar reaches *into* the
 *    game content, after the letterbox bars have absorbed part of it.
 *
 * Everything here is in **design-space coordinates**: the design rect is `{x: 0, y: 0, width: dw,
 * height: dh}`.
 */

export type SurfacePreviewSize = {
    width: number;
    height: number;
};

export type SurfacePreviewRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type SurfacePreviewInsets = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

/* -------------------------------------------------------------------------- */
/* Aspect ratio presets                                                        */
/* -------------------------------------------------------------------------- */

export type SurfacePreviewAspectPresetId =
    | "16:9"
    | "16:10"
    | "4:3"
    | "21:9"
    | "19.5:9"
    | "9:16";

export type SurfacePreviewAspectPreset = {
    id: SurfacePreviewAspectPresetId;
    /**
     * Exact fraction, never a rounded decimal — `ratio.w / ratio.h` is the width/height ratio.
     * The frame math divides by `ratio.h` last so common cases (16:9 against 1920x1080) land on
     * exact integers instead of drifting by a float ulp.
     */
    ratio: { w: number; h: number };
};

export const SURFACE_PREVIEW_ASPECT_PRESETS: readonly SurfacePreviewAspectPreset[] = [
    { id: "16:9", ratio: { w: 16, h: 9 } },
    { id: "16:10", ratio: { w: 16, h: 10 } },
    { id: "4:3", ratio: { w: 4, h: 3 } },
    { id: "21:9", ratio: { w: 21, h: 9 } },
    // 19.5:9 as an integer fraction so the ratio stays exact.
    { id: "19.5:9", ratio: { w: 39, h: 18 } },
    { id: "9:16", ratio: { w: 9, h: 16 } },
];

export function getSurfacePreviewAspectPreset(
    id: string | null | undefined,
): SurfacePreviewAspectPreset | null {
    if (!id) {
        return null;
    }
    return SURFACE_PREVIEW_ASPECT_PRESETS.find(preset => preset.id === id) ?? null;
}

export function isSurfacePreviewAspectPresetId(id: unknown): id is SurfacePreviewAspectPresetId {
    return typeof id === "string" && SURFACE_PREVIEW_ASPECT_PRESETS.some(preset => preset.id === id);
}

/* -------------------------------------------------------------------------- */
/* Safe-area device presets                                                    */
/* -------------------------------------------------------------------------- */

export type SurfacePreviewOrientation = "landscape" | "portrait";

export type SafeAreaGeometry = {
    /** Logical screen size in pt (iOS) or dp (Android), in this orientation. */
    screen: SurfacePreviewSize;
    insets: SurfacePreviewInsets;
};

/**
 * A safe-area preset is a *device*, not a flat percentage: the whole point is that the letterbox bars
 * can swallow the notch entirely, in which case the correct answer is "no risk on this device".
 *
 * Both orientations are carried because iOS insets differ substantially between them. The consuming
 * math picks one automatically from the design size — there is no separate control for it.
 */
export type SafeAreaPreset = {
    id: string;
    /** Device the numbers were measured on. Surfaced in the toolbar menu, so keep it exact. */
    reference: string;
    landscape: SafeAreaGeometry;
    portrait: SafeAreaGeometry;
};

/**
 * Source notes — these numbers look arbitrary without them:
 *
 * 1. iOS landscape side insets are **mirrored**: Apple applies the same inset to both edges
 *    regardless of which side the sensor housing is on. Equal left/right is deliberate, not a
 *    copy-paste error.
 * 2. The iOS home indicator is 21pt in landscape and 34pt in portrait, constant from iPhone X
 *    through iPhone 16 Pro Max.
 * 3. Android values are **AOSP defaults** (`navigation_bar_height` = 24dp in the gestural overlay).
 *    A fullscreen/immersive game reports *zero* status-bar and nav-bar insets, but the bottom
 *    home-gesture zone is a mandatory gesture area that cannot be excluded — which is why Android
 *    carries a bottom inset and nothing else. OEM overlays vary these, so treat Android as a
 *    baseline rather than per-device truth.
 * 4. Apple publishes no official inset table; these are community-measured per-generation values
 *    (useyourloaf.com), independently corroborated for the iPhone 12/13 generation.
 * 5. iOS 26-era hardware (iPhone 17 / Air) breaks the pattern with a non-zero landscape *top* inset
 *    of 20pt. Single source, not yet corroborated, so it is deliberately not in this table.
 */
export const SAFE_AREA_PRESETS: readonly SafeAreaPreset[] = [
    {
        id: "ios-dynamic-island",
        reference: "iPhone 15 Pro",
        landscape: {
            screen: { width: 852, height: 393 },
            insets: { left: 59, right: 59, top: 0, bottom: 21 },
        },
        portrait: {
            screen: { width: 393, height: 852 },
            insets: { left: 0, right: 0, top: 59, bottom: 34 },
        },
    },
    {
        id: "ios-notch",
        reference: "iPhone 13",
        landscape: {
            screen: { width: 844, height: 390 },
            insets: { left: 47, right: 47, top: 0, bottom: 21 },
        },
        portrait: {
            screen: { width: 390, height: 844 },
            insets: { left: 0, right: 0, top: 47, bottom: 34 },
        },
    },
    {
        id: "android-gesture",
        reference: "Pixel 7",
        landscape: {
            screen: { width: 915, height: 412 },
            insets: { left: 0, right: 0, top: 0, bottom: 24 },
        },
        portrait: {
            screen: { width: 412, height: 915 },
            insets: { left: 0, right: 0, top: 0, bottom: 24 },
        },
    },
];

export function getSafeAreaPreset(id: string | null | undefined): SafeAreaPreset | null {
    if (!id) {
        return null;
    }
    return SAFE_AREA_PRESETS.find(preset => preset.id === id) ?? null;
}

export function isSafeAreaPresetId(id: unknown): boolean {
    return typeof id === "string" && SAFE_AREA_PRESETS.some(preset => preset.id === id);
}

/** Square designs count as landscape; there is no third case to show. */
export function pickSurfacePreviewOrientation(designSize: SurfacePreviewSize): SurfacePreviewOrientation {
    return designSize.width >= designSize.height ? "landscape" : "portrait";
}

/* -------------------------------------------------------------------------- */
/* Screen-ratio frame                                                          */
/* -------------------------------------------------------------------------- */

export type ScreenRatioFrame = {
    /**
     * The player's screen expressed in design-space coordinates. Always *contains* the design rect
     * and touches it on the constrained axis, because the engine scales by `min(W/dw, H/dh)`.
     */
    screenRect: SurfacePreviewRect;
    /** Pillarbox bar thickness in design units (per side). 0 when the screen is not relatively wider. */
    pillarbox: number;
    /** Letterbox bar thickness in design units (per side). 0 when the screen is not relatively taller. */
    letterbox: number;
    /** `pillarbox / screenRect.width` — 0 .. 0.5. Handy for "12% of the screen is bar". */
    pillarboxFraction: number;
    /** `letterbox / screenRect.height` — 0 .. 0.5. */
    letterboxFraction: number;
};

function isUsableSize(size: SurfacePreviewSize | null | undefined): size is SurfacePreviewSize {
    return (
        !!size &&
        Number.isFinite(size.width) &&
        Number.isFinite(size.height) &&
        size.width > 0 &&
        size.height > 0
    );
}

/**
 * Screen rect (in design space) for a design of `designSize` shown on a screen of the preset's ratio.
 *
 * ```
 * screenW = max(dw, dh * r)      screenH = max(dh, dw / r)
 * x = -(screenW - dw) / 2        y = -(screenH - dh) / 2
 * ```
 *
 * Returns `null` for degenerate input rather than producing NaN geometry.
 */
export function computeScreenRatioFrame(input: {
    designSize: SurfacePreviewSize;
    preset: SurfacePreviewAspectPreset;
}): ScreenRatioFrame | null {
    const { designSize, preset } = input;
    if (!isUsableSize(designSize)) {
        return null;
    }
    const { w: rw, h: rh } = preset.ratio;
    if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) {
        return null;
    }

    const dw = designSize.width;
    const dh = designSize.height;
    // Divide last so exact-match cases (16:9 vs 1920x1080) come out exact rather than off by an ulp.
    const screenW = Math.max(dw, (dh * rw) / rh);
    const screenH = Math.max(dh, (dw * rh) / rw);
    if (!Number.isFinite(screenW) || !Number.isFinite(screenH)) {
        return null;
    }

    const pillarbox = (screenW - dw) / 2;
    const letterbox = (screenH - dh) / 2;

    return {
        screenRect: {
            // `-0` is harmless in CSS but poisons equality checks and snapshots — normalize it away.
            x: pillarbox === 0 ? 0 : -pillarbox,
            y: letterbox === 0 ? 0 : -letterbox,
            width: screenW,
            height: screenH,
        },
        pillarbox,
        letterbox,
        pillarboxFraction: screenW > 0 ? pillarbox / screenW : 0,
        letterboxFraction: screenH > 0 ? letterbox / screenH : 0,
    };
}

/* -------------------------------------------------------------------------- */
/* Safe-area frame                                                             */
/* -------------------------------------------------------------------------- */

export type SafeAreaFrame = {
    /** The safe region in design space. Equals the design rect when `fullySafe`. */
    safeRect: SurfacePreviewRect;
    /** How far each device inset reaches into the content, in design units. */
    insets: SurfacePreviewInsets;
    /** True when every inset is 0 — the bars swallowed the notch, the content is genuinely safe. */
    fullySafe: boolean;
    /** Which of the preset's two orientations the design size selected. */
    orientation: SurfacePreviewOrientation;
};

/**
 * Safe rect (in design space) for a design of `designSize` shown on one orientation of a device.
 *
 * ```
 * fit = min(screenW / dw, screenH / dh)      // pt per design unit
 * cw  = dw * fit,  ch = dh * fit             // content box on the device, in pt
 * ox  = (screenW - cw) / 2                   // pillarbox thickness, pt
 * oy  = (screenH - ch) / 2                   // letterbox thickness, pt
 * insetLeft = max(0, insets.left - ox) / fit // design units
 * ```
 *
 * When the bars are thicker than the inset the notch lands in the bar and the inset is 0 — that is a
 * correct and useful answer, so it is deliberately NOT clamped up to a minimum visible inset.
 *
 * Returns `null` for degenerate input rather than producing NaN geometry.
 */
export function computeSafeAreaFrameForGeometry(input: {
    designSize: SurfacePreviewSize;
    geometry: SafeAreaGeometry;
    orientation: SurfacePreviewOrientation;
}): SafeAreaFrame | null {
    const { designSize, geometry, orientation } = input;
    if (!isUsableSize(designSize) || !isUsableSize(geometry.screen)) {
        return null;
    }
    const raw = geometry.insets;
    if (
        !Number.isFinite(raw.left) ||
        !Number.isFinite(raw.right) ||
        !Number.isFinite(raw.top) ||
        !Number.isFinite(raw.bottom)
    ) {
        return null;
    }

    const dw = designSize.width;
    const dh = designSize.height;
    const fit = Math.min(geometry.screen.width / dw, geometry.screen.height / dh);
    if (!Number.isFinite(fit) || fit <= 0) {
        return null;
    }

    const cw = dw * fit;
    const ch = dh * fit;
    const ox = (geometry.screen.width - cw) / 2;
    const oy = (geometry.screen.height - ch) / 2;

    const insets: SurfacePreviewInsets = {
        left: Math.max(0, raw.left - ox) / fit,
        right: Math.max(0, raw.right - ox) / fit,
        top: Math.max(0, raw.top - oy) / fit,
        bottom: Math.max(0, raw.bottom - oy) / fit,
    };

    const fullySafe =
        insets.left === 0 && insets.right === 0 && insets.top === 0 && insets.bottom === 0;

    return {
        safeRect: {
            x: insets.left,
            y: insets.top,
            // Floor at 0: a preset whose insets exceed the screen must not produce inverted geometry.
            width: Math.max(0, dw - insets.left - insets.right),
            height: Math.max(0, dh - insets.top - insets.bottom),
        },
        insets,
        fullySafe,
        orientation,
    };
}

/**
 * Safe rect for a device preset, picking the orientation from the design size automatically
 * (`width >= height` => landscape). See `computeSafeAreaFrameForGeometry` for the math.
 */
export function computeSafeAreaFrame(input: {
    designSize: SurfacePreviewSize;
    preset: SafeAreaPreset;
}): SafeAreaFrame | null {
    const { designSize, preset } = input;
    if (!isUsableSize(designSize)) {
        return null;
    }
    const orientation = pickSurfacePreviewOrientation(designSize);
    return computeSafeAreaFrameForGeometry({
        designSize,
        geometry: preset[orientation],
        orientation,
    });
}

/* -------------------------------------------------------------------------- */
/* Convenience: id -> frame                                                    */
/* -------------------------------------------------------------------------- */

/** Resolve an aspect preset id and compute its frame in one step. Unknown id => `null`. */
export function computeScreenRatioFrameById(
    designSize: SurfacePreviewSize,
    aspectId: string | null | undefined,
): ScreenRatioFrame | null {
    const preset = getSurfacePreviewAspectPreset(aspectId);
    return preset ? computeScreenRatioFrame({ designSize, preset }) : null;
}

/** Resolve a device preset id and compute its safe frame in one step. Unknown id => `null`. */
export function computeSafeAreaFrameById(
    designSize: SurfacePreviewSize,
    safeAreaId: string | null | undefined,
): SafeAreaFrame | null {
    const preset = getSafeAreaPreset(safeAreaId);
    return preset ? computeSafeAreaFrame({ designSize, preset }) : null;
}
