import { describe, expect, it } from "vitest";
import {
    SAFE_AREA_PRESETS,
    SURFACE_PREVIEW_ASPECT_PRESETS,
    computeSafeAreaFrame,
    computeSafeAreaFrameById,
    computeSafeAreaFrameForGeometry,
    computeScreenRatioFrame,
    computeScreenRatioFrameById,
    computeUnsafeBands,
    getSafeAreaPreset,
    getSurfacePreviewAspectPreset,
    isSafeAreaPresetId,
    isSurfacePreviewAspectPresetId,
    pickSurfacePreviewOrientation,
    resolveSafeAreaOrientation,
    type SafeAreaGeometry,
    type SafeAreaPreset,
    type SurfacePreviewAspectPreset,
} from "./surfacePreviewFrames";

const DESIGN_1920x1080 = { width: 1920, height: 1080 };

function aspect(id: string): SurfacePreviewAspectPreset {
    const preset = getSurfacePreviewAspectPreset(id);
    if (!preset) {
        throw new Error(`missing aspect preset ${id}`);
    }
    return preset;
}

function safeArea(id: string): SafeAreaPreset {
    const preset = getSafeAreaPreset(id);
    if (!preset) {
        throw new Error(`missing safe-area preset ${id}`);
    }
    return preset;
}

/** Ad-hoc device with the same geometry in both orientations — for math-only cases. */
function fakeDevice(geometry: SafeAreaGeometry): SafeAreaPreset {
    return { id: "test", reference: "test", family: "android", landscape: geometry, portrait: geometry };
}

describe("aspect preset table", () => {
    it("exposes the six documented ids with exact integer fractions", () => {
        expect(SURFACE_PREVIEW_ASPECT_PRESETS.map(p => p.id)).toEqual([
            "16:9",
            "16:10",
            "4:3",
            "21:9",
            "19.5:9",
            "9:16",
        ]);
        for (const preset of SURFACE_PREVIEW_ASPECT_PRESETS) {
            expect(Number.isInteger(preset.ratio.w)).toBe(true);
            expect(Number.isInteger(preset.ratio.h)).toBe(true);
            expect(preset.ratio.w).toBeGreaterThan(0);
            expect(preset.ratio.h).toBeGreaterThan(0);
        }
    });

    it("stores 19.5:9 as an exact fraction, not a rounded decimal", () => {
        const preset = aspect("19.5:9");
        expect(preset.ratio).toEqual({ w: 39, h: 18 });
        expect(preset.ratio.w / preset.ratio.h).toBeCloseTo(2.16667, 5);
    });

    it("validates ids", () => {
        expect(isSurfacePreviewAspectPresetId("16:9")).toBe(true);
        expect(isSurfacePreviewAspectPresetId("32:9")).toBe(false);
        expect(isSurfacePreviewAspectPresetId(null)).toBe(false);
        expect(getSurfacePreviewAspectPreset("nope")).toBeNull();
        expect(getSurfacePreviewAspectPreset(null)).toBeNull();
        expect(getSurfacePreviewAspectPreset(undefined)).toBeNull();
    });
});

describe("computeScreenRatioFrame", () => {
    it("16:9 against 1920x1080 has no bars at all — screen rect equals the design rect exactly", () => {
        const frame = computeScreenRatioFrame({
            designSize: DESIGN_1920x1080,
            preset: aspect("16:9"),
        });
        expect(frame).not.toBeNull();
        expect(frame!.screenRect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
        expect(frame!.pillarbox).toBe(0);
        expect(frame!.letterbox).toBe(0);
        expect(frame!.pillarboxFraction).toBe(0);
        expect(frame!.letterboxFraction).toBe(0);
    });

    it("21:9 against 1920x1080 pillarboxes only, symmetrically", () => {
        const frame = computeScreenRatioFrame({
            designSize: DESIGN_1920x1080,
            preset: aspect("21:9"),
        })!;
        // screenW = 1080 * 21 / 9 = 2520, screenH stays 1080.
        expect(frame.screenRect.width).toBe(2520);
        expect(frame.screenRect.height).toBe(1080);
        expect(frame.screenRect.y).toBe(0);
        expect(frame.letterbox).toBe(0);
        expect(frame.pillarbox).toBe(300);
        expect(frame.screenRect.x).toBe(-300);
        // Symmetric: the design rect sits dead centre.
        expect(frame.screenRect.x + frame.screenRect.width).toBe(1920 + 300);
        expect(frame.pillarboxFraction).toBeCloseTo(300 / 2520, 12);
        expect(frame.letterboxFraction).toBe(0);
    });

    it("9:16 against 1920x1080 letterboxes only, symmetrically", () => {
        const frame = computeScreenRatioFrame({
            designSize: DESIGN_1920x1080,
            preset: aspect("9:16"),
        })!;
        // screenH = 1920 * 16 / 9 = 3413.333..., screenW stays 1920.
        expect(frame.screenRect.width).toBe(1920);
        expect(frame.screenRect.x).toBe(0);
        expect(frame.pillarbox).toBe(0);
        expect(frame.screenRect.height).toBeCloseTo(30720 / 9, 9);
        expect(frame.letterbox).toBeCloseTo((30720 / 9 - 1080) / 2, 9);
        expect(frame.screenRect.y).toBeCloseTo(-frame.letterbox, 12);
        expect(frame.screenRect.y + frame.screenRect.height).toBeCloseTo(1080 + frame.letterbox, 9);
        expect(frame.letterboxFraction).toBeCloseTo(frame.letterbox / frame.screenRect.height, 12);
    });

    it("only one axis ever grows — design taller than the target ratio pillarboxes", () => {
        // 4:3 design (1.333) shown at 16:9 (1.778) => screen must grow horizontally only.
        const frame = computeScreenRatioFrame({
            designSize: { width: 1024, height: 768 },
            preset: aspect("16:9"),
        })!;
        expect(frame.screenRect.height).toBe(768);
        expect(frame.screenRect.y).toBe(0);
        expect(frame.letterbox).toBe(0);
        expect(frame.screenRect.width).toBeCloseTo((768 * 16) / 9, 9);
        expect(frame.pillarbox).toBeGreaterThan(0);
    });

    it("only one axis ever grows — design wider than the target ratio letterboxes", () => {
        // 21:9 design (2.333) shown at 4:3 (1.333) => screen must grow vertically only.
        const frame = computeScreenRatioFrame({
            designSize: { width: 2520, height: 1080 },
            preset: aspect("4:3"),
        })!;
        expect(frame.screenRect.width).toBe(2520);
        expect(frame.screenRect.x).toBe(0);
        expect(frame.pillarbox).toBe(0);
        expect(frame.screenRect.height).toBeCloseTo((2520 * 3) / 4, 9);
        expect(frame.letterbox).toBeGreaterThan(0);
    });

    it("the screen rect always contains the design rect, for every preset", () => {
        const designs = [
            { width: 1920, height: 1080 },
            { width: 1024, height: 768 },
            { width: 1080, height: 1920 },
            { width: 2560, height: 1080 },
            { width: 800, height: 800 },
        ];
        for (const designSize of designs) {
            for (const preset of SURFACE_PREVIEW_ASPECT_PRESETS) {
                const frame = computeScreenRatioFrame({ designSize, preset })!;
                expect(frame).not.toBeNull();
                expect(frame.screenRect.x).toBeLessThanOrEqual(0);
                expect(frame.screenRect.y).toBeLessThanOrEqual(0);
                expect(frame.screenRect.x + frame.screenRect.width).toBeGreaterThanOrEqual(
                    designSize.width - 1e-9,
                );
                expect(frame.screenRect.y + frame.screenRect.height).toBeGreaterThanOrEqual(
                    designSize.height - 1e-9,
                );
                // Touches on the constrained axis: at least one of the two bars is exactly 0.
                expect(Math.min(frame.pillarbox, frame.letterbox)).toBe(0);
            }
        }
    });

    it("returns null for degenerate design sizes", () => {
        const preset = aspect("16:9");
        expect(computeScreenRatioFrame({ designSize: { width: 0, height: 1080 }, preset })).toBeNull();
        expect(computeScreenRatioFrame({ designSize: { width: 1920, height: 0 }, preset })).toBeNull();
        expect(computeScreenRatioFrame({ designSize: { width: -1920, height: 1080 }, preset })).toBeNull();
        expect(
            computeScreenRatioFrame({ designSize: { width: Number.NaN, height: 1080 }, preset }),
        ).toBeNull();
        expect(
            computeScreenRatioFrame({
                designSize: { width: Number.POSITIVE_INFINITY, height: 1080 },
                preset,
            }),
        ).toBeNull();
    });

    it("returns null for a degenerate ratio", () => {
        expect(
            computeScreenRatioFrame({
                designSize: DESIGN_1920x1080,
                preset: { id: "16:9", ratio: { w: 0, h: 9 } } as SurfacePreviewAspectPreset,
            }),
        ).toBeNull();
        expect(
            computeScreenRatioFrame({
                designSize: DESIGN_1920x1080,
                preset: { id: "16:9", ratio: { w: 16, h: Number.NaN } } as SurfacePreviewAspectPreset,
            }),
        ).toBeNull();
    });
});

describe("safe-area preset table", () => {
    it("is a real device list, every entry consistent across its two orientations", () => {
        expect(SAFE_AREA_PRESETS.length).toBeGreaterThanOrEqual(10);
        expect(new Set(SAFE_AREA_PRESETS.map(p => p.id)).size).toBe(SAFE_AREA_PRESETS.length);
        expect(new Set(SAFE_AREA_PRESETS.map(p => p.family))).toEqual(new Set(["iphone", "ipad", "android"]));
        for (const preset of SAFE_AREA_PRESETS) {
            expect(preset.reference).toBeTruthy();
            expect(preset.landscape.screen.width).toBeGreaterThanOrEqual(preset.landscape.screen.height);
            expect(preset.portrait.screen.height).toBeGreaterThanOrEqual(preset.portrait.screen.width);
            // The two orientations are the same physical panel rotated.
            expect(preset.landscape.screen.width).toBe(preset.portrait.screen.height);
            expect(preset.landscape.screen.height).toBe(preset.portrait.screen.width);
            for (const geometry of [preset.landscape, preset.portrait]) {
                for (const side of ["left", "right", "top", "bottom"] as const) {
                    expect(Number.isFinite(geometry.insets[side])).toBe(true);
                    expect(geometry.insets[side]).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    it("carries the sourced iOS numbers, with mirrored landscape side insets", () => {
        const island = safeArea("iphone-15-pro");
        expect(island.reference).toBe("iPhone 15 Pro");
        expect(island.landscape).toEqual({
            screen: { width: 852, height: 393 },
            insets: { left: 59, right: 59, top: 0, bottom: 21 },
        });
        expect(island.portrait).toEqual({
            screen: { width: 393, height: 852 },
            insets: { left: 0, right: 0, top: 59, bottom: 34 },
        });

        const notch = safeArea("iphone-14");
        expect(notch.landscape.insets).toEqual({ left: 47, right: 47, top: 0, bottom: 21 });
        expect(notch.portrait.insets).toEqual({ left: 0, right: 0, top: 47, bottom: 34 });

        // The mini costs MORE than the 13/14 despite the same logical size: same notch, less width.
        expect(safeArea("iphone-13-mini").portrait.insets.top).toBe(50);
        expect(safeArea("iphone-16-pro").portrait.insets.top).toBe(62);

        for (const preset of SAFE_AREA_PRESETS.filter(p => p.family === "iphone" && p.portrait.insets.top > 0)) {
            // Mirrored on purpose: Apple applies the same inset to both edges in landscape, and the
            // side inset is exactly the portrait top inset.
            expect(preset.landscape.insets.left).toBe(preset.landscape.insets.right);
            expect(preset.landscape.insets.left).toBe(preset.portrait.insets.top);
            // Home indicator: 21pt landscape, 34pt portrait, constant across the generations.
            expect(preset.landscape.insets.bottom).toBe(21);
            expect(preset.portrait.insets.bottom).toBe(34);
        }
    });

    it("models THIS product's shells: hidden status bar zeroes the top inset without ears", () => {
        // Apple's own answer: an iPad with the status bar hidden reports {0,0,20,0}. The iPhone's
        // top inset survives because it is the sensor housing, not the status bar.
        for (const id of ["ipad-10", "ipad-pro-11"]) {
            const pad = safeArea(id);
            expect(pad.portrait.insets).toEqual({ left: 0, right: 0, top: 0, bottom: 20 });
            expect(pad.landscape.insets).toEqual({ left: 0, right: 0, top: 0, bottom: 20 });
        }
        // No ears AND no home indicator: safe on every edge, which is a real answer worth having.
        const se = safeArea("iphone-se-3");
        expect(se.portrait.insets).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
        expect(se.landscape.insets).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    });

    it("models Android as the display cutout, NOT the hidden navigation bar", () => {
        const android = safeArea("android-punch-hole");
        expect(android.family).toBe("android");
        // The old table had this exactly backwards: bottom 24dp and no cutout at all.
        expect(android.portrait.insets).toEqual({ left: 0, right: 0, top: 48, bottom: 0 });
        expect(android.landscape.insets).toEqual({ left: 48, right: 48, top: 0, bottom: 0 });
    });

    it("still resolves the preset ids that shipped before the table was rebuilt", () => {
        // Persisted in Studio settings and carried on a Dev Mode launch entry — dropping them would
        // silently turn the overlay off for anyone who had one selected.
        expect(getSafeAreaPreset("iphone-15-pro")?.id).toBe("iphone-15-pro");
        expect(getSafeAreaPreset("iphone-14")?.id).toBe("iphone-14");
        expect(getSafeAreaPreset("android-punch-hole")?.id).toBe("android-punch-hole");
        expect(isSafeAreaPresetId("iphone-14")).toBe(true);
    });

    it("takes the orientation from the project setting, not from the design size", () => {
        const preset = safeArea("iphone-15-pro");
        // A landscape stage in a portrait-locked project: the housing is on the top edge, not the sides.
        const forced = computeSafeAreaFrame({
            designSize: DESIGN_1920x1080,
            preset,
            mobileOrientation: "portrait",
        })!;
        expect(forced.orientation).toBe("portrait");
        expect(computeSafeAreaFrame({ designSize: DESIGN_1920x1080, preset })!.orientation).toBe("landscape");
        // `auto` locks nothing, so there is no answer to read and the design size decides.
        expect(
            computeSafeAreaFrame({ designSize: DESIGN_1920x1080, preset, mobileOrientation: "auto" })!.orientation,
        ).toBe("landscape");
        expect(resolveSafeAreaOrientation({ width: 1080, height: 1920 }, "auto")).toBe("portrait");
        expect(resolveSafeAreaOrientation({ width: 1080, height: 1920 }, "landscape")).toBe("landscape");
    });

    it("every table entry produces usable geometry for a normal design size", () => {
        for (const preset of SAFE_AREA_PRESETS) {
            for (const designSize of [DESIGN_1920x1080, { width: 1080, height: 1920 }]) {
                const frame = computeSafeAreaFrame({ designSize, preset })!;
                expect(frame).not.toBeNull();
                expect(frame.safeRect.width).toBeGreaterThan(0);
                expect(frame.safeRect.height).toBeGreaterThan(0);
                expect(frame.safeRect.x).toBeGreaterThanOrEqual(0);
                expect(frame.safeRect.y).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it("validates ids", () => {
        expect(isSafeAreaPresetId("iphone-14")).toBe(true);
        expect(isSafeAreaPresetId("pixel-9000")).toBe(false);
        expect(getSafeAreaPreset("pixel-9000")).toBeNull();
        expect(getSafeAreaPreset(null)).toBeNull();
    });
});

describe("orientation selection", () => {
    it("picks landscape for wide and square designs, portrait for tall ones", () => {
        expect(pickSurfacePreviewOrientation({ width: 1920, height: 1080 })).toBe("landscape");
        expect(pickSurfacePreviewOrientation({ width: 800, height: 800 })).toBe("landscape");
        expect(pickSurfacePreviewOrientation({ width: 1080, height: 1920 })).toBe("portrait");
    });

    it("reads the matching orientation out of the preset", () => {
        const island = safeArea("iphone-15-pro");
        const landscape = computeSafeAreaFrame({ designSize: DESIGN_1920x1080, preset: island })!;
        expect(landscape.orientation).toBe("landscape");
        // Landscape has no top inset at all; portrait's 59pt notch is on top.
        expect(landscape.insets.top).toBe(0);

        // Portrait 9:16 design on a 393x852 screen: fit = 393/1080, ch = 698.67, so the letterbox
        // bar is 76.67pt — thicker than both the 59pt notch and the 34pt home indicator. The whole
        // device is absorbed by the bars and the content is genuinely safe.
        const portrait = computeSafeAreaFrame({
            designSize: { width: 1080, height: 1920 },
            preset: island,
        })!;
        expect(portrait.orientation).toBe("portrait");
        expect(portrait.fullySafe).toBe(true);
        expect(portrait.safeRect).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });

        // A taller 19.5:9 portrait design nearly fills the panel (oy = 0.25pt), so the notch bites.
        const tall = computeSafeAreaFrame({ designSize: { width: 1080, height: 2340 }, preset: island })!;
        expect(tall.orientation).toBe("portrait");
        expect(tall.insets.left).toBe(0);
        expect(tall.insets.right).toBe(0);
        expect(tall.insets.top).toBeGreaterThan(0);
        expect(tall.insets.bottom).toBeGreaterThan(0);
        expect(tall.fullySafe).toBe(false);
    });
});

describe("computeSafeAreaFrame — worked examples", () => {
    it("1920x1080 on iPhone 15 Pro landscape: sides fully absorbed by the pillarbox, bottom bites", () => {
        // fit = min(852/1920, 393/1080) = 393/1080 = 0.363888...
        // content = 698.67 x 393 pt => ox = (852 - 698.67)/2 = 76.67, oy = 0
        // left  = max(0, 59 - 76.67) / fit = 0   <- the whole reason for device presets
        // bottom = 21 / 0.363888... = 57.7099... design px
        const frame = computeSafeAreaFrame({
            designSize: DESIGN_1920x1080,
            preset: safeArea("iphone-15-pro"),
        })!;
        expect(frame.orientation).toBe("landscape");
        expect(frame.insets.left).toBe(0);
        expect(frame.insets.right).toBe(0);
        expect(frame.insets.top).toBe(0);
        expect(frame.insets.bottom).toBeCloseTo(22680 / 393, 9);
        expect(frame.insets.bottom).toBeCloseTo(57.7099, 4);
        expect(frame.fullySafe).toBe(false);
        expect(frame.safeRect.x).toBe(0);
        expect(frame.safeRect.y).toBe(0);
        expect(frame.safeRect.width).toBe(1920);
        expect(frame.safeRect.height).toBeCloseTo(1022.2901, 4);
    });

    it("16:9 on Android: the pillarbox eats most of the punch hole, nothing at the bottom", () => {
        // fit = min(915/1920, 412/1080) = 412/1080 = 0.381481...; content 732.4 wide in a 915 screen,
        // so each pillarbox is 91.3dp — thicker than half the 48dp cutout but not all of it.
        const fit = 412 / 1080;
        const ox = (915 - 1920 * fit) / 2;
        const frame = computeSafeAreaFrame({
            designSize: DESIGN_1920x1080,
            preset: safeArea("android-punch-hole"),
        })!;
        expect(frame.orientation).toBe("landscape");
        expect(ox).toBeGreaterThan(48);
        // The bars swallow the cutout whole on this shape — and the hidden nav bar contributes
        // nothing, so a 16:9 game is genuinely clear on a punch-hole phone.
        expect(frame.insets).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
        expect(frame.fullySafe).toBe(true);
    });

    it("a 21:9 design on Android does lose its edges to the punch hole", () => {
        // Wider design => a thinner pillarbox => the cutout reaches past it into the content.
        const design = { width: 2520, height: 1080 };
        const fit = Math.min(915 / 2520, 412 / 1080);
        const frame = computeSafeAreaFrame({ designSize: design, preset: safeArea("android-punch-hole") })!;
        const ox = (915 - 2520 * fit) / 2;
        expect(ox).toBeLessThan(48);
        expect(frame.insets.left).toBeCloseTo((48 - ox) / fit, 9);
        expect(frame.insets.left).toBe(frame.insets.right);
        expect(frame.insets.bottom).toBe(0);
        expect(frame.fullySafe).toBe(false);
    });
});

describe("computeSafeAreaFrame — math", () => {
    it("reports fullySafe when the letterbox bars swallow every inset", () => {
        // Device 1000x500 (2.0), design 1600x1000 (1.6) => fit = 0.5, cw = 800, ox = 100 pt.
        // Left/right insets of 40 pt land inside the 100 pt pillarbox bar => zero inset.
        const frame = computeSafeAreaFrame({
            designSize: { width: 1600, height: 1000 },
            preset: fakeDevice({
                screen: { width: 1000, height: 500 },
                insets: { left: 40, right: 40, top: 0, bottom: 0 },
            }),
        })!;
        expect(frame.fullySafe).toBe(true);
        expect(frame.insets).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
        expect(frame.safeRect).toEqual({ x: 0, y: 0, width: 1600, height: 1000 });
    });

    it("passes insets through scaled only by fit when the design ratio matches the device exactly", () => {
        // Device 1000x500 (2.0), design 2000x1000 (2.0) => fit = 0.5, ox = oy = 0.
        // insetLeft = (44 - 0) / 0.5 = 88 design units; insetBottom = 21 / 0.5 = 42.
        const frame = computeSafeAreaFrame({
            designSize: { width: 2000, height: 1000 },
            preset: fakeDevice({
                screen: { width: 1000, height: 500 },
                insets: { left: 44, right: 44, top: 0, bottom: 21 },
            }),
        })!;
        expect(frame.insets).toEqual({ left: 88, right: 88, top: 0, bottom: 42 });
        expect(frame.safeRect).toEqual({ x: 88, y: 0, width: 1824, height: 958 });
        expect(frame.fullySafe).toBe(false);
    });

    it("subtracts only the bar it shares an axis with", () => {
        // Device 1000x500 (2.0), design 1600x1000 (1.6) => fit = 0.5, ox = 100, oy = 0.
        // left 140 pt -> (140 - 100) / 0.5 = 80 design units.
        // bottom 30 pt -> (30 - 0) / 0.5 = 60 design units (no letterbox on this axis).
        const frame = computeSafeAreaFrame({
            designSize: { width: 1600, height: 1000 },
            preset: fakeDevice({
                screen: { width: 1000, height: 500 },
                insets: { left: 140, right: 0, top: 0, bottom: 30 },
            }),
        })!;
        expect(frame.insets).toEqual({ left: 80, right: 0, top: 0, bottom: 60 });
        expect(frame.safeRect).toEqual({ x: 80, y: 0, width: 1520, height: 940 });
        expect(frame.fullySafe).toBe(false);
    });

    it("does not clamp a nearly-absorbed inset up to a minimum visible one", () => {
        // ox = 100 for a 1600x1000 design => 99.9 is fully absorbed.
        const frame = computeSafeAreaFrame({
            designSize: { width: 1600, height: 1000 },
            preset: fakeDevice({
                screen: { width: 1000, height: 500 },
                insets: { left: 99.9, right: 0, top: 0, bottom: 0 },
            }),
        })!;
        expect(frame.insets.left).toBe(0);
        expect(frame.fullySafe).toBe(true);
    });

    it("never produces inverted geometry when insets exceed the content", () => {
        const frame = computeSafeAreaFrame({
            designSize: { width: 2000, height: 1000 },
            preset: fakeDevice({
                screen: { width: 1000, height: 500 },
                insets: { left: 900, right: 900, top: 400, bottom: 400 },
            }),
        })!;
        expect(frame.safeRect.width).toBeGreaterThanOrEqual(0);
        expect(frame.safeRect.height).toBeGreaterThanOrEqual(0);
    });

    it("returns null for degenerate inputs", () => {
        const device = fakeDevice({
            screen: { width: 1000, height: 500 },
            insets: { left: 0, right: 0, top: 0, bottom: 0 },
        });
        expect(computeSafeAreaFrame({ designSize: { width: 0, height: 1080 }, preset: device })).toBeNull();
        expect(
            computeSafeAreaFrame({ designSize: { width: 1920, height: -1 }, preset: device }),
        ).toBeNull();
        expect(
            computeSafeAreaFrame({ designSize: { width: Number.NaN, height: 1080 }, preset: device }),
        ).toBeNull();
        expect(
            computeSafeAreaFrameForGeometry({
                designSize: DESIGN_1920x1080,
                geometry: { screen: { width: 0, height: 500 }, insets: { left: 0, right: 0, top: 0, bottom: 0 } },
                orientation: "landscape",
            }),
        ).toBeNull();
        expect(
            computeSafeAreaFrameForGeometry({
                designSize: DESIGN_1920x1080,
                geometry: {
                    screen: { width: Number.POSITIVE_INFINITY, height: 500 },
                    insets: { left: 0, right: 0, top: 0, bottom: 0 },
                },
                orientation: "landscape",
            }),
        ).toBeNull();
        expect(
            computeSafeAreaFrameForGeometry({
                designSize: DESIGN_1920x1080,
                geometry: {
                    screen: { width: 1000, height: 500 },
                    insets: { left: Number.NaN, right: 0, top: 0, bottom: 0 },
                },
                orientation: "landscape",
            }),
        ).toBeNull();
    });
});

describe("computeUnsafeBands", () => {
    it("covers only the home-indicator strip for a 16:9 design on a notched iPhone", () => {
        // The pillarbox is thicker than the housing on every 16:9-on-iPhone combination, so the only
        // thing left is the home indicator at the bottom. This IS the shape of the common case.
        const iphones = SAFE_AREA_PRESETS.filter(p => p.family === "iphone" && p.portrait.insets.top > 0);
        expect(iphones.length).toBeGreaterThan(0);
        for (const preset of iphones) {
            const frame = computeSafeAreaFrame({ designSize: DESIGN_1920x1080, preset })!;
            const bands = computeUnsafeBands(DESIGN_1920x1080, frame);
            expect(bands).toHaveLength(1);
            expect(bands[0].x).toBe(0);
            expect(bands[0].width).toBe(1920);
            expect(bands[0].height).toBeCloseTo(frame.insets.bottom, 6);
            expect(bands[0].y).toBeCloseTo(1080 - frame.insets.bottom, 6);
        }
    });

    it("has nothing to cover on the devices a 16:9 game is genuinely clear on", () => {
        // An iPad's letterbox is deeper than its home indicator, an SE has no insets at all, and the
        // Android pillarbox swallows the punch hole. All three are real "no risk here" answers, and
        // all three draw an empty canvas — which is why the readout says it in words.
        for (const id of ["ipad-10", "ipad-pro-11", "iphone-se-3", "android-punch-hole"]) {
            const frame = computeSafeAreaFrame({ designSize: DESIGN_1920x1080, preset: safeArea(id) })!;
            expect(frame.fullySafe).toBe(true);
            expect(computeUnsafeBands(DESIGN_1920x1080, frame)).toEqual([]);
        }
    });

    it("gives the corners to the horizontal bands so no area is covered twice", () => {
        const frame = computeSafeAreaFrameForGeometry({
            designSize: { width: 1000, height: 1000 },
            geometry: {
                screen: { width: 1000, height: 1000 },
                insets: { left: 10, right: 20, top: 30, bottom: 40 },
            },
            orientation: "landscape",
        })!;
        const bands = computeUnsafeBands({ width: 1000, height: 1000 }, frame);
        expect(bands).toEqual([
            { x: 0, y: 0, width: 1000, height: 30 },
            { x: 0, y: 960, width: 1000, height: 40 },
            { x: 0, y: 30, width: 10, height: 930 },
            { x: 980, y: 30, width: 20, height: 930 },
        ]);
        const area = bands.reduce((sum, b) => sum + b.width * b.height, 0);
        // 1000x1000 minus the safe rect: no overlap means the two agree exactly.
        expect(area).toBe(1000 * 1000 - frame.safeRect.width * frame.safeRect.height);
    });

    it("is empty for the real preset that reaches fullySafe: Pixel 7 against a portrait design", () => {
        // The pillarbox/letterbox swallows the 24dp gesture zone whole, so the honest answer is
        // "nothing is covered" - and the canvas then looks identical to the layer being off, which
        // is the entire reason `SurfacePreviewFramesReadout` says it in words.
        const portrait = { width: 1080, height: 1920 };
        const frame = computeSafeAreaFrame({ designSize: portrait, preset: safeArea("android-punch-hole") })!;
        expect(frame.orientation).toBe("portrait");
        expect(frame.fullySafe).toBe(true);
        expect(computeUnsafeBands(portrait, frame)).toEqual([]);
    });

    it("is empty for a fully safe frame, a null frame and a degenerate design", () => {
        const fully = computeSafeAreaFrameForGeometry({
            designSize: { width: 1000, height: 1000 },
            geometry: { screen: { width: 1000, height: 1000 }, insets: { left: 0, right: 0, top: 0, bottom: 0 } },
            orientation: "landscape",
        })!;
        expect(fully.fullySafe).toBe(true);
        expect(computeUnsafeBands({ width: 1000, height: 1000 }, fully)).toEqual([]);
        expect(computeUnsafeBands(DESIGN_1920x1080, null)).toEqual([]);
        const frame = computeSafeAreaFrame({ designSize: DESIGN_1920x1080, preset: safeArea("iphone-14") })!;
        expect(computeUnsafeBands({ width: 0, height: 1080 }, frame)).toEqual([]);
    });

    it("clamps insets that swallow the whole design rather than inverting geometry", () => {
        const frame = computeSafeAreaFrameForGeometry({
            designSize: { width: 100, height: 100 },
            geometry: { screen: { width: 100, height: 100 }, insets: { left: 0, right: 0, top: 400, bottom: 0 } },
            orientation: "portrait",
        })!;
        const bands = computeUnsafeBands({ width: 100, height: 100 }, frame);
        expect(bands).toEqual([{ x: 0, y: 0, width: 100, height: 100 }]);
    });
});

describe("id convenience wrappers", () => {
    it("resolve known ids and return null for unknown / null ids", () => {
        expect(computeScreenRatioFrameById(DESIGN_1920x1080, "16:9")).not.toBeNull();
        expect(computeScreenRatioFrameById(DESIGN_1920x1080, "nope")).toBeNull();
        expect(computeScreenRatioFrameById(DESIGN_1920x1080, null)).toBeNull();
        expect(computeSafeAreaFrameById(DESIGN_1920x1080, "iphone-14")).not.toBeNull();
        expect(computeSafeAreaFrameById(DESIGN_1920x1080, "nope")).toBeNull();
        expect(computeSafeAreaFrameById(DESIGN_1920x1080, null)).toBeNull();
    });
});
