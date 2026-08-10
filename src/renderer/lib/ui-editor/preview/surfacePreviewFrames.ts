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

/** Menu grouping. Also the shape of the inset rule that produced the numbers. */
export type SafeAreaDeviceFamily = "iphone" | "ipad" | "android";

/**
 * A safe-area preset is a *device*, not a flat percentage: the whole point is that the letterbox bars
 * can swallow the notch entirely, in which case the correct answer is "no risk on this device".
 *
 * Both orientations are carried because iOS insets differ substantially between them.
 */
export type SafeAreaPreset = {
    id: string;
    /** Exact marketing name — it is what the menu and the readout show. */
    reference: string;
    family: SafeAreaDeviceFamily;
    landscape: SafeAreaGeometry;
    portrait: SafeAreaGeometry;
};

/**
 * What a device contributes before the rule below turns it into two geometries.
 *
 * `points` is the PORTRAIT logical size, and it is `nativePixels / scale` — an arithmetic identity
 * from two first-party numbers, so a typo in either is catchable rather than a silent lie. `housing`
 * is the only per-device inset value; everything else comes from the shared rule.
 */
type SafeAreaDeviceSpec = {
    id: string;
    reference: string;
    family: SafeAreaDeviceFamily;
    /** Portrait logical size in pt (iOS) / dp (Android). */
    points: SurfacePreviewSize;
    /**
     * How far the sensor housing / display cutout reaches into the screen, in logical units: the
     * portrait top inset, and (mirrored) the landscape side inset. 0 for a device with no cutout.
     */
    housing: number;
    /** Home-indicator inset: `[portrait, landscape]`. `[0, 0]` for a home-button device. */
    homeIndicator: [number, number];
};

/**
 * Real devices, and the rule that turns each into a pair of geometries.
 *
 * **These numbers describe THIS product's shells, not a generic app.** Both mobile shells run the
 * game full-screen with the system chrome out of the way, and the exported entry document carries
 * `viewport-fit=cover` (`webShell.ts`), so the page's layout viewport is the whole screen and the
 * game genuinely paints under the housing:
 *
 * - **iOS** (`@narraleaf/studio-shell`): `UIStatusBarHidden`, `prefersStatusBarHidden`,
 *   `prefersHomeIndicatorAutoHidden`, and `setContentInsetAdjustmentBehavior` on the WKWebView's
 *   scroll view.
 * - **Android**: `enterImmersiveMode` + `setDecorFitsSystemWindows(false)` + a non-default
 *   `layoutInDisplayCutoutMode`, i.e. edge-to-edge with the system bars hidden and the content laid
 *   out into the cutout.
 *
 * Two consequences that a generic inset table gets wrong, and that this one gets right:
 *
 * 1. **A hidden status bar zeroes the top inset on a device with no "ears".** Apple's own answer
 *    (developer.apple.com/forums/thread/110724): an iPad with the status bar hidden reports
 *    `{0, 0, 20, 0}` — "the non-zero top inset on the iPhone is the exceptional case, it's there
 *    because the iPhone has ears, not because of the iPhone's status bar". So an iPad here has NO
 *    top inset, and an iPhone SE is safe on every edge, while a notched iPhone keeps its housing.
 * 2. **Android reports the display cutout, not the navigation bar.** WebView forwards system-bar
 *    insets only where the bars actually overlap the WebView (developer.android.com — "Understand
 *    window insets in WebView"), and this shell hides them. The bottom gesture strip is therefore
 *    *not* part of `env(safe-area-inset-bottom)` here — which is exactly backwards from what this
 *    table used to say, when Android's only inset was a 24dp bottom one and it had no cutout at all.
 *    The gesture strip is still a bad place for a button; it is a touch-routing hazard rather than
 *    an occlusion, and this overlay deliberately draws only what is covered.
 *
 * Sources for the device numbers: logical point sizes and portrait insets from useyourloaf.com's
 * per-generation screen-size tables (iPhone 13 / 14 / 16), which are the corroborated community
 * reference — Apple publishes screen sizes but no inset table. The landscape rule (sides mirrored to
 * the portrait top inset, 21pt home indicator) is from the iPhone X measurements and has held for
 * every generation since.
 *
 * ⚠ **The Android entry is a typical device, not a measured one.** Cutout geometry is per-OEM and
 * no first-party table exists; its name says so. The honest fix is to read `env(safe-area-inset-*)`
 * off a real handset, which nothing in this product does yet.
 */
const SAFE_AREA_DEVICES: readonly SafeAreaDeviceSpec[] = [
    // 750x1334 @2x. Home button: no ears and no home indicator, so with the status bar hidden it is
    // safe on every edge. Kept precisely because "this device has no risk" is a real answer.
    { id: "iphone-se-3", reference: "iPhone SE (3rd gen)", family: "iphone", points: { width: 375, height: 667 }, housing: 0, homeIndicator: [0, 0] },
    // 1125x2436 @3x. The mini's housing costs MORE than a 13's (50 vs 47): same notch, narrower screen.
    { id: "iphone-13-mini", reference: "iPhone 13 mini", family: "iphone", points: { width: 375, height: 812 }, housing: 50, homeIndicator: [34, 21] },
    // 1170x2532 @3x — iPhone 12/12 Pro, 13/13 Pro, 14.
    { id: "iphone-14", reference: "iPhone 14", family: "iphone", points: { width: 390, height: 844 }, housing: 47, homeIndicator: [34, 21] },
    // 1284x2778 @3x — iPhone 12/13 Pro Max, 14 Plus.
    { id: "iphone-14-plus", reference: "iPhone 14 Plus", family: "iphone", points: { width: 428, height: 926 }, housing: 47, homeIndicator: [34, 21] },
    // 1179x2556 @3x — iPhone 14 Pro, 15, 15 Pro, 16. First Dynamic Island size.
    { id: "iphone-15-pro", reference: "iPhone 15 Pro", family: "iphone", points: { width: 393, height: 852 }, housing: 59, homeIndicator: [34, 21] },
    // 1290x2796 @3x — iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus.
    { id: "iphone-15-pro-max", reference: "iPhone 15 Pro Max", family: "iphone", points: { width: 430, height: 932 }, housing: 59, homeIndicator: [34, 21] },
    // 1206x2622 @3x. The 16 Pro pair is the first to go past 59.
    { id: "iphone-16-pro", reference: "iPhone 16 Pro", family: "iphone", points: { width: 402, height: 874 }, housing: 62, homeIndicator: [34, 21] },
    // 1320x2868 @3x.
    { id: "iphone-16-pro-max", reference: "iPhone 16 Pro Max", family: "iphone", points: { width: 440, height: 956 }, housing: 62, homeIndicator: [34, 21] },
    // 1640x2360 @2x. No ears; status bar hidden => top 0. The home indicator is 20pt on iPad, and it
    // does not shrink in landscape the way the iPhone's does.
    { id: "ipad-10", reference: "iPad (10th gen)", family: "ipad", points: { width: 820, height: 1180 }, housing: 0, homeIndicator: [20, 20] },
    // 1668x2388 @2x.
    { id: "ipad-pro-11", reference: "iPad Pro 11\"", family: "ipad", points: { width: 834, height: 1194 }, housing: 0, homeIndicator: [20, 20] },
    // Pixel-class 1080x2400 @2.625. Housing = a punch hole on the top edge, which lands on a short
    // edge in landscape; mirrored like iOS because the shell may lock either landscape rotation.
    // No home-indicator inset: the gesture strip is not reported as safe-area here (see above).
    { id: "android-punch-hole", reference: "Android punch-hole (typical)", family: "android", points: { width: 412, height: 915 }, housing: 48, homeIndicator: [0, 0] },
];

/**
 * The rule, applied once per device.
 *
 * Landscape mirrors the housing onto BOTH side edges: Apple insets both sides equally regardless of
 * which way the phone is turned, so content does not jump when the player rotates — and our shells
 * can lock either landscape rotation, so the same is the safe reading on Android.
 */
function expandSafeAreaDevice(device: SafeAreaDeviceSpec): SafeAreaPreset {
    const { width, height } = device.points;
    const [portraitIndicator, landscapeIndicator] = device.homeIndicator;
    return {
        id: device.id,
        reference: device.reference,
        family: device.family,
        portrait: {
            screen: { width, height },
            insets: { left: 0, right: 0, top: device.housing, bottom: portraitIndicator },
        },
        landscape: {
            screen: { width: height, height: width },
            insets: { left: device.housing, right: device.housing, top: 0, bottom: landscapeIndicator },
        },
    };
}

export const SAFE_AREA_PRESETS: readonly SafeAreaPreset[] = SAFE_AREA_DEVICES.map(expandSafeAreaDevice);

/**
 * Ids this table used to ship, mapped to the device they actually described.
 *
 * A preset id is persisted in Studio settings and travels on a Dev Mode launch entry, so dropping
 * these would silently turn the overlay off for anyone who had one selected — which is the exact
 * "I picked something and nothing happened" this whole feature has already been reported for once.
 */
const LEGACY_SAFE_AREA_PRESET_IDS: Readonly<Record<string, string>> = {
    "ios-dynamic-island": "iphone-15-pro",
    "ios-notch": "iphone-14",
    "android-gesture": "android-punch-hole",
};

export function getSafeAreaPreset(id: string | null | undefined): SafeAreaPreset | null {
    if (!id) {
        return null;
    }
    const resolved = LEGACY_SAFE_AREA_PRESET_IDS[id] ?? id;
    return SAFE_AREA_PRESETS.find(preset => preset.id === resolved) ?? null;
}

export function isSafeAreaPresetId(id: unknown): boolean {
    return typeof id === "string" && getSafeAreaPreset(id) !== null;
}

/** Square designs count as landscape; there is no third case to show. */
export function pickSurfacePreviewOrientation(designSize: SurfacePreviewSize): SurfacePreviewOrientation {
    return designSize.width >= designSize.height ? "landscape" : "portrait";
}

/**
 * How the project says its mobile builds are rotated (`app.mobile.orientation`). `auto` means the
 * shell locks nothing, so there is no answer to read and the design size is the best guess left.
 */
export type SafeAreaMobileOrientation = "landscape" | "portrait" | "auto";

/**
 * Which orientation the device is held in, for inset purposes.
 *
 * The project setting wins because it is what the shells actually do — `setRequestedOrientation` on
 * Android, `UISupportedInterfaceOrientations` on iOS. Inferring it from the design size instead is
 * only right by coincidence: it agrees with the setting in a well-formed project and quietly shows
 * the wrong edge in exactly the projects that need checking, and it cannot represent `auto` at all.
 */
export function resolveSafeAreaOrientation(
    designSize: SurfacePreviewSize,
    mobileOrientation?: SafeAreaMobileOrientation | null,
): SurfacePreviewOrientation {
    if (mobileOrientation === "landscape" || mobileOrientation === "portrait") {
        return mobileOrientation;
    }
    return pickSurfacePreviewOrientation(designSize);
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
    /** The project's `app.mobile.orientation`; omitted / `auto` falls back to the design size. */
    mobileOrientation?: SafeAreaMobileOrientation | null;
}): SafeAreaFrame | null {
    const { designSize, preset, mobileOrientation } = input;
    if (!isUsableSize(designSize)) {
        return null;
    }
    const orientation = resolveSafeAreaOrientation(designSize, mobileOrientation);
    return computeSafeAreaFrameForGeometry({
        designSize,
        geometry: preset[orientation],
        orientation,
    });
}

/**
 * The parts of the design rect the device insets cover, as up to four rects in design space.
 *
 * Horizontal bands span the full width and the vertical ones only the strip between them, so the
 * corners are covered exactly once — a translucent fill would otherwise stack there and read as a
 * darker patch that means nothing.
 *
 * Empty for a `fullySafe` frame, which is why the readout has to say so in words: "nothing is
 * covered" and "the layer is off" look identical on the canvas.
 */
export function computeUnsafeBands(
    designSize: SurfacePreviewSize,
    frame: SafeAreaFrame | null | undefined,
): SurfacePreviewRect[] {
    if (!frame || frame.fullySafe || !isUsableSize(designSize)) {
        return [];
    }
    const dw = designSize.width;
    const dh = designSize.height;
    const { top, bottom, left, right } = frame.insets;
    const middleHeight = Math.max(0, dh - top - bottom);
    const bands: SurfacePreviewRect[] = [];
    if (top > 0) {
        bands.push({ x: 0, y: 0, width: dw, height: Math.min(top, dh) });
    }
    if (bottom > 0) {
        const height = Math.min(bottom, dh);
        bands.push({ x: 0, y: dh - height, width: dw, height });
    }
    if (left > 0 && middleHeight > 0) {
        bands.push({ x: 0, y: top, width: Math.min(left, dw), height: middleHeight });
    }
    if (right > 0 && middleHeight > 0) {
        const width = Math.min(right, dw);
        bands.push({ x: dw - width, y: top, width, height: middleHeight });
    }
    return bands;
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
    mobileOrientation?: SafeAreaMobileOrientation | null,
): SafeAreaFrame | null {
    const preset = getSafeAreaPreset(safeAreaId);
    return preset ? computeSafeAreaFrame({ designSize, preset, mobileOrientation }) : null;
}
