import { useMemo, useState, type CSSProperties } from "react";
import {
    cropLayoutStyle,
    getUICharacterWidgetProps,
} from "@shared/types/ui-editor/character";
import { useTranslation } from "@/lib/i18n";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { useFramedCharacter } from "@/lib/ui-editor/runtime/app/FramedCharacterContext";
import { useCharacterPreviewSrcs } from "@/lib/workspace/hooks/useCharacterPreviewSrcs";

/**
 * The window the crop opens onto the picture. Absolute inside the chrome, so radius, border, fill
 * and opacity stay the chrome's job — and so the clipping an avatar frame needs is the chrome's
 * corner radius rather than a second rounding of our own.
 */
const WINDOW_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    borderRadius: "inherit",
    // The character is a picture, not a control.
    pointerEvents: "none",
};

/**
 * One layer of the stack.
 *
 * The layers share the box `cropLayoutStyle` computed, and that box already has the picture's own
 * aspect — so each layer fills it exactly and no per-layer fitting is left to do. That is also what
 * keeps a layered character aligned: every layer of one is the same canvas, so one box places all of
 * them.
 */
const LAYER_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "fill",
};

/**
 * Draws whichever character the frame around it is showing.
 *
 * Where the pictures come from is the whole design, so it is worth stating in one place:
 *
 *  - **A running story** hands them over through {@link useFramedCharacter} — they are what the
 *    *engine* resolved for the element this surface is drawn inside. Studio does not resolve a
 *    character's appearance twice, which is the entire reason the engine grew an image backend.
 *  - **The editor canvas** has no running story, so the named character's default look is
 *    composited from the project as a preview. That path never ships: in a packaged game the hook
 *    is replaced by a shim that answers nothing.
 *
 * A frame with no character in it draws its chrome and nothing else — an ordinary thing for an
 * author to design, and the reason there is no "missing character" alarm here.
 */
export function CharacterRenderer(props: WidgetRendererProps) {
    const { t } = useTranslation();
    const widget = getUICharacterWidgetProps(props.element);
    const framed = useFramedCharacter();

    // Only the editor path needs the project, and only when nothing live is showing. The hook is
    // called unconditionally (it is a hook) and declines cheaply when a story is running.
    const previewId = framed.state ? null : widget.characterId ?? framed.characterId ?? null;
    const preview = useCharacterPreviewSrcs(previewId);

    const { srcs, colour } = useMemo(() => {
        if (framed.state?.kind === "image") {
            return { srcs: framed.state.content.srcs, colour: framed.state.content.colour };
        }
        // A puppet-drawn character is mounted by `nl.puppet`, not here: what the engine hands over
        // for one is named state, not pictures, and the model belongs to the author's runtime.
        if (framed.state?.kind === "puppet") {
            return { srcs: [] as (string | null)[], colour: null };
        }
        return { srcs: preview.srcs, colour: null };
    }, [framed.state, preview.srcs]);

    // The picture's own pixel size, read once when the first layer loads. A layered character's
    // layers are one canvas, so the first to arrive answers for all of them.
    const [picture, setPicture] = useState<{ width: number; height: number } | null>(null);
    const box = {
        width: props.element.layout.width,
        height: props.element.layout.height,
    };
    const innerStyle = useMemo<CSSProperties>(() => ({
        position: "absolute",
        transform: widget.flipX ? "scaleX(-1)" : undefined,
        ...cropLayoutStyle({ crop: widget.crop, fit: widget.fit, box, picture }),
    }), [widget.crop.x, widget.crop.y, widget.crop.w, widget.crop.h, widget.fit, widget.flipX, box.width, box.height, picture]);

    return (
        <RectangleChromeRenderer {...props}>
            <div style={WINDOW_STYLE} data-widget-character="">
                <div style={innerStyle}>
                    {colour ? <div style={{ ...LAYER_STYLE, background: colour }} /> : null}
                    {srcs.map((src, index) => src === null ? null : (
                        <img
                            key={`layer-${index}`}
                            src={src}
                            alt={t("widgets.defaults.character.name")}
                            draggable={false}
                            style={LAYER_STYLE}
                            onLoad={index === 0
                                ? event => {
                                    const img = event.currentTarget;
                                    setPicture(current =>
                                        current && current.width === img.naturalWidth && current.height === img.naturalHeight
                                            ? current
                                            : { width: img.naturalWidth, height: img.naturalHeight });
                                }
                                : undefined}
                        />
                    ))}
                </div>
            </div>
        </RectangleChromeRenderer>
    );
}
