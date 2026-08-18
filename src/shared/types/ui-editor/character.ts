/**
 * `nl.character` — the widget that draws whichever character the surface is showing.
 *
 * Every other picture widget names its own artwork. This one names none: what it draws is decided by
 * the story, and the surface it sits on is drawn *inside a stage element* whose element is the
 * character. So the widget's whole job is presentation — which part of the picture, how it fills the
 * box — and its content arrives from the engine.
 *
 * ## Why there is no `assetId` here, and why that is the point
 *
 * The engine resolves what a character looks like: which tag group is selected, which layers that
 * resolves to, which URLs those are. Studio asking the same question a second time is the drift this
 * widget exists to avoid, so the sources come through `FramedCharacterContext` — the engine's own
 * answer, handed over by the image backend — and never from a lookup of our own. The one exception
 * is the editor canvas, where there is no running story and a preview has to be composited from the
 * project; that path is a preview and is never what ships.
 *
 * ## The crop is a rect over the picture, not a size
 *
 * `crop` is normalised (0–1) over the character's own canvas, which is the same shape the character
 * store already uses for portrait framing. Expressed that way it survives everything that would
 * break a pixel offset: a different pose, a re-export at another resolution, a frame the author
 * resizes afterwards. The box it fills is the element's own `UILayout` width and height — there is
 * no second size here, for the reason `nl.puppet` gives: two sources for one number is how a widget
 * ends up drawing at a size its selection outline disagrees with.
 */
export const UI_CHARACTER_ELEMENT_TYPE = "nl.character";

/** How the picture fills the cropped window: like `object-fit`, and for the same reasons. */
export type UICharacterFit = "cover" | "contain";

export type UICharacterCrop = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type UICharacterWidgetProps = {
    /**
     * Whose picture to draw, or `null` for "whichever character this frame was put on stage for".
     *
     * `null` is the ordinary case and the one that makes a frame reusable: one avatar frame drawn
     * once and worn by the whole cast. A named character is for a frame that is about one of them —
     * and it is also what the editor canvas previews when no story is running.
     */
    characterId: string | null;
    /** The window over the character's canvas, normalised. Defaults to the whole picture. */
    crop: UICharacterCrop;
    fit: UICharacterFit;
    /** Mirror horizontally — the cheap way to have a character face the other way. */
    flipX: boolean;
};

export const DEFAULT_UI_CHARACTER_CROP: UICharacterCrop = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_UI_CHARACTER_WIDGET_PROPS: UICharacterWidgetProps = {
    characterId: null,
    crop: DEFAULT_UI_CHARACTER_CROP,
    fit: "cover",
    flipX: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Clamp one crop edge into the picture.
 *
 * A crop wider than the picture is not an error worth refusing — an author dragging a crop box will
 * produce one constantly — but a zero or negative extent is: it divides the layout by zero. The
 * floor is deliberately a visible sliver rather than a full frame, so a crop dragged to nothing
 * looks wrong instead of looking like no crop at all.
 */
function normalizeExtent(value: unknown, fallback: number): number {
    const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(1, Math.max(0.01, n));
}

function normalizeOrigin(value: unknown, fallback: number): number {
    const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(1, Math.max(0, n));
}

export function normalizeUICharacterCrop(raw: unknown): UICharacterCrop {
    const input = isRecord(raw) ? raw : {};
    return {
        x: normalizeOrigin(input.x, DEFAULT_UI_CHARACTER_CROP.x),
        y: normalizeOrigin(input.y, DEFAULT_UI_CHARACTER_CROP.y),
        w: normalizeExtent(input.w, DEFAULT_UI_CHARACTER_CROP.w),
        h: normalizeExtent(input.h, DEFAULT_UI_CHARACTER_CROP.h),
    };
}

export function normalizeUICharacterWidgetProps(raw: unknown): UICharacterWidgetProps {
    const input = isRecord(raw) ? raw : {};
    const characterId = typeof input.characterId === "string" && input.characterId.trim().length > 0
        ? input.characterId.trim()
        : null;
    return {
        characterId,
        crop: normalizeUICharacterCrop(input.crop),
        fit: input.fit === "contain" ? "contain" : "cover",
        flipX: input.flipX === true,
    };
}

export function getUICharacterWidgetProps(element: { props?: unknown }): UICharacterWidgetProps {
    return normalizeUICharacterWidgetProps(element.props);
}

/**
 * Where the picture sits inside the box, given the crop.
 *
 * Three sizes decide it and all three are known without guessing: the box the author drew
 * (`UILayout`), the picture's own pixel size (read once when it loads), and the crop. The result is
 * the picture's own rectangle — same aspect as the picture, never distorted — positioned so that the
 * crop's centre lands on the box's centre.
 *
 * `fit` is what happens when the crop and the box disagree about shape: `cover` scales until the
 * crop covers the box and lets the excess fall outside it, `contain` scales until the whole crop is
 * inside and leaves the rest of the box empty. That is `object-fit`'s meaning, applied to the *crop*
 * rather than to the whole picture — which is the only reading that makes a crop worth authoring.
 */
export function cropLayoutStyle(input: {
    crop: UICharacterCrop;
    fit: UICharacterFit;
    box: { width: number; height: number };
    picture: { width: number; height: number } | null;
}): { width: string; height: string; left: string; top: string } {
    const { crop, fit, box } = input;
    // Before the picture has loaded there is nothing to be proportional to. Filling the box is the
    // least surprising placeholder: it is what an uncropped, unfitted picture would do, and it is
    // replaced on the next frame.
    if (!input.picture || input.picture.width <= 0 || input.picture.height <= 0) {
        return { width: "100%", height: "100%", left: "0px", top: "0px" };
    }
    const cropWidth = crop.w * input.picture.width;
    const cropHeight = crop.h * input.picture.height;
    const scaleX = box.width / cropWidth;
    const scaleY = box.height / cropHeight;
    const scale = fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    const width = input.picture.width * scale;
    const height = input.picture.height * scale;
    return {
        width: `${width}px`,
        height: `${height}px`,
        left: `${box.width / 2 - (crop.x + crop.w / 2) * width}px`,
        top: `${box.height / 2 - (crop.y + crop.h / 2) * height}px`,
    };
}
