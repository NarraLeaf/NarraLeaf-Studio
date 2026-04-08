import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type FocusEvent,
    type KeyboardEvent,
} from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { getTextProps } from "./helpers";
import type { TextWrapMode } from "./types";

function lineWrapCss(mode: TextWrapMode): Pick<CSSProperties, "whiteSpace" | "wordBreak" | "overflowWrap"> {
    switch (mode) {
        case "word":
            return { whiteSpace: "pre-wrap", wordBreak: "normal", overflowWrap: "break-word" };
        case "character":
            return { whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "normal" };
        case "nowrap":
            return { whiteSpace: "nowrap", wordBreak: "normal", overflowWrap: "normal" };
    }
}

export function TextRenderer({ element, surface }: WidgetRendererProps) {
    const stateService = UIEditorStateService.getInstance();
    const documentService = UIDocumentService.getInstance();
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());

    useEffect(() => {
        const unsub = stateService.on("interactionOverrideChanged", setInteractionOverride);
        return unsub;
    }, [stateService]);

    const isEditing =
        interactionOverride?.kind === "textEdit" &&
        interactionOverride.surfaceId === surface.id &&
        interactionOverride.elementId === element.id;

    const p = getTextProps(element);
    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);

    const sharedStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        margin: 0,
        padding: 4,
        boxSizing: "border-box",
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color,
        textAlign: p.textAlign,
        lineHeight: p.lineHeight,
        ...lineWrapCss(p.textWrapMode),
        overflow: "hidden",
        ...(editorFontFamily ? { fontFamily: editorFontFamily } : {}),
    };

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const skipBlurCommitRef = useRef(false);

    const commitAndClose = useCallback(
        (nextText: string) => {
            documentService.updateElementProps(element.id, {
                ...element.props,
                text: nextText,
            });
            stateService.setInteractionOverride(null);
        },
        [documentService, element.id, element.props, stateService],
    );

    useEffect(() => {
        if (!isEditing) {
            return;
        }
        const el = textareaRef.current;
        if (!el) {
            return;
        }
        el.focus();
        el.select();
    }, [isEditing]);

    const handleTextareaKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                skipBlurCommitRef.current = true;
                stateService.setInteractionOverride(null);
            }
        },
        [stateService],
    );

    const handleTextareaBlur = useCallback(
        (e: FocusEvent<HTMLTextAreaElement>) => {
            if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
            }
            commitAndClose(e.target.value);
        },
        [commitAndClose],
    );

    if (isEditing) {
        return (
            <textarea
                ref={textareaRef}
                defaultValue={p.text}
                style={{
                    ...sharedStyle,
                    resize: "none",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    ...(p.textWrapMode === "nowrap" ? { overflowX: "auto", overflowY: "hidden" } : {}),
                    ...(!editorFontFamily ? { fontFamily: "inherit" } : {}),
                }}
                onBlur={handleTextareaBlur}
                onKeyDown={handleTextareaKeyDown}
            />
        );
    }

    return <p style={sharedStyle}>{p.text}</p>;
}
