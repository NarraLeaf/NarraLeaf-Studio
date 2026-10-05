import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";

/** What a text paints as when its stored colour cannot be read at all. */
const TEXT_COLOR_FALLBACK = { hex: "#FFFFFF", alpha: 1 };

/**
 * What a text widget's stored colour paints as: always something a browser can render.
 *
 * The stored value may be a brand link (`nlbrand:text.primary`), which no browser understands, so it
 * is resolved against the project palette as it stands right now - the reading every other colour
 * field gets through `parseColorValue`. A value that cannot be read at all, a link to an entry the
 * palette does not have included, paints white.
 *
 * The one statement for both ways a text is drawn. The canvas paints its paragraph with it; the
 * dialogue and NVL lines hand it to the engine's typewriter as the line's default colour. When the
 * second passed the stored string through instead, the browser dropped the declaration and the words
 * took whatever colour the page around the stage happened to have - near-black on Studio's light
 * theme, which made a line in a dark dialogue box disappear.
 *
 * The answer is read at render time, so a caller that has to follow palette edits subscribes to them
 * (`useBrandPaletteRevision`) - nothing in an element's props says the palette moved.
 */
export function resolveTextPaintColor(stored: string | undefined): string {
    return colorValueToCss(parseColorValue(stored, TEXT_COLOR_FALLBACK));
}
