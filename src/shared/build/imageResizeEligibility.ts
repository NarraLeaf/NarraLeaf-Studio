/**
 * Which images a build may make smaller without moving anything on the screen.
 *
 * The size cap in advanced image compression shrinks the file, and that is only safe for an image
 * whose drawn size does not come from its pixels. The engine draws most images from their pixels:
 * a character sprite, and an `/image` row without auto-fit, are laid out at their natural size times
 * the stage scale (NarraLeaf's `AspectScaleImage`). A sprite made half as large on disk stood half as
 * tall in the shipped game - and only there, because Dev Mode and the preview never use the
 * re-encoded files, so the author had no way to see it before a player did.
 *
 * Three kinds of place draw an image at a size its pixels do not decide:
 *
 * - a scene's background and a `/bg` row, which the engine scales to the stage's width;
 * - an `/image` row that creates its image with auto-fit on, the same rule;
 * - an interface image filled into a box - a widget's fill in cover, contain, stretch or crop mode,
 *   or a Surface's background in cover, contain or stretch - which the box sizes. A tile repeats the
 *   picture at its own size, so a tile is not one of them.
 *
 * An image may be resized only when every reference to it is one of these. Anything else that names
 * it keeps it at its size: a character, a row that changes an image's source, a mask, a transition,
 * a blueprint literal, plugin data, and whatever command or widget is added after this was written.
 * Those are not listed here; they are found by the sweep that decides what a package carries
 * (`collectReferencedIds`), run over the bundle with the three kinds of place taken out of it.
 */

import type { DevModeBundle } from "@shared/types/devMode";
import { collectReferencedIds } from "./variantPayload";

/** Widget fill modes the box sizes. `tile` repeats the picture at its natural size. */
const BOX_FILL_MODES: ReadonlySet<string> = new Set(["cover", "contain", "stretch", "crop"]);

/** Surface background modes the design area sizes; the same exception for `tile`. */
const SURFACE_BACKGROUND_FILL_MODES: ReadonlySet<string> = new Set(["cover", "contain", "stretch"]);

/**
 * The only ids the sweep can find, so the only ids this may answer for. An id of any other shape
 * named somewhere else would not be found there, and the image would be resized under a sprite.
 */
const SWEEPABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The bundle as a reference sweep reads it: without the maps keyed by asset id over the whole
 * library.
 *
 * The asset name table lists every asset by construction, and the audio clip table every clip, so
 * sweeping either answers "all of them" whatever the story does. What a package carries and which
 * images it may resize are both decided over this.
 */
export function withoutLibraryTables(bundle: DevModeBundle): DevModeBundle {
    return {
        ...bundle,
        ...(bundle.storyLibrary ? { storyLibrary: { ...bundle.storyLibrary, assetNames: {} } } : {}),
        ...(bundle.audio ? { audio: { ...bundle.audio, clips: {} } } : {}),
    };
}

/**
 * The images in `bundle` that may be scaled down: named somewhere, and only in places that draw
 * them at a size their pixels do not decide.
 *
 * `extra` is everything else the package carries that can name an asset - a plugin's published
 * data. Ids come back as the documents write them, lower-cased when a document did not.
 */
export function findResizableImages(input: {
    bundle: DevModeBundle;
    extra?: readonly unknown[];
}): Set<string> {
    const placed = new Set<string>();
    const take = (value: unknown): undefined => {
        if (typeof value === "string" && SWEEPABLE_ID.test(value)) {
            placed.add(value.toLowerCase());
        }
        return undefined;
    };

    const { ui, ...rest } = withoutLibraryTables(input.bundle);
    const { uidoc, ...uiRest } = ui;
    const story = JSON.stringify(rest, function storySite(this: unknown, key: string, value: unknown) {
        if (key === "defaultBackgroundAssetId") {
            return take(value);
        }
        if (key === "assetId" && isRecord(this)) {
            if (this.action === "setBackground") {
                return take(value);
            }
            if (this.action === "image" && this.operation === "create" && this.autoFit === true) {
                return take(value);
            }
        }
        return value;
    });
    const interfaceDocument = JSON.stringify(uidoc, function boxSite(this: unknown, key: string, value: unknown) {
        if (key === "assetId" && isRecord(this)) {
            if (typeof this.mode === "string" && BOX_FILL_MODES.has(this.mode)) {
                return take(value);
            }
            if (typeof this.fillMode === "string" && SURFACE_BACKGROUND_FILL_MODES.has(this.fillMode)) {
                return take(value);
            }
        }
        return value;
    });

    // Strings, not the objects: the sweep reads JSON text, and these are already the text with the
    // places above left out of it.
    const elsewhere = collectReferencedIds([story, interfaceDocument, uiRest, input.extra ?? []], placed);
    return new Set([...placed].filter(id => !elsewhere.has(id)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
