import { Fragment } from "react";
import {
    needsTateChuYokoSegments,
    segmentVerticalText,
    type VerticalTypographySettings,
} from "./verticalTypography";

/**
 * Renders text with its short Latin and digit runs set upright across the column (縦中横).
 *
 * Returns the string itself whenever nothing would be combined, so horizontal text - and vertical
 * text made only of CJK - keeps a single text node and no per-run elements.
 */
export function renderVerticalTextContent(text: string, settings: VerticalTypographySettings) {
    if (!needsTateChuYokoSegments(text, settings)) {
        return text;
    }
    return segmentVerticalText(text, settings.tateChuYokoMaxLength).map((segment, index) =>
        segment.combineUpright ? (
            <span key={index} style={{ textCombineUpright: "all" }}>
                {segment.text}
            </span>
        ) : (
            <Fragment key={index}>{segment.text}</Fragment>
        ),
    );
}
