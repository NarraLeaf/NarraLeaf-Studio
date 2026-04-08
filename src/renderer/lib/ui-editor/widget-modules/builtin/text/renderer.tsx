import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type FocusEvent,
    type FormEvent,
    type KeyboardEvent,
} from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import { getTextProps } from "./helpers";

export function TextRenderer({ element, surface }: WidgetRendererProps) {
    const stateService = UIEditorStateService.getInstance();
    const documentService = UIDocumentService.getInstance();
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());
    const draftRef = useRef("");
    const skipBlurCommitRef = useRef(false);

    useEffect(() => {
        return stateService.on("interactionOverrideChanged", payload => {
            const { previous, next } = payload;
            setInteractionOverride(next);

            const wasHere =
                previous?.kind === "textEdit" &&
                previous.surfaceId === surface.id &&
                previous.elementId === element.id;
            const isHere =
                next?.kind === "textEdit" &&
                next.surfaceId === surface.id &&
                next.elementId === element.id;

            if (isHere && !wasHere) {
                const docEl = documentService.getDocument().elements[element.id];
                draftRef.current = docEl ? getTextProps(docEl).text : "";
            }

            if (wasHere && !isHere) {
                if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                } else {
                    const docEl = documentService.getDocument().elements[element.id];
                    if (docEl) {
                        documentService.updateElementProps(element.id, {
                            ...docEl.props,
                            text: draftRef.current,
                        });
                    }
                }
            }
        });
    }, [stateService, documentService, element.id, surface.id]);

    const isEditing =
        interactionOverride?.kind === "textEdit" &&
        interactionOverride.surfaceId === surface.id &&
        interactionOverride.elementId === element.id;

    useLayoutEffect(() => {
        if (!isEditing) {
            return;
        }
        const docEl = documentService.getDocument().elements[element.id];
        draftRef.current = docEl ? getTextProps(docEl).text : "";
    }, [isEditing, documentService, element.id]);

    const p = getTextProps(element);
    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);

    const textBodyStyle: CSSProperties = {
        width: "100%",
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

    const outerStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        minHeight: 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: textVerticalAlignToJustifyContent(p.textVerticalAlign),
        alignItems: "stretch",
    };

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

    const handleTextareaInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
        draftRef.current = e.currentTarget.value;
    }, []);

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
            <div style={outerStyle}>
                <textarea
                    ref={textareaRef}
                    defaultValue={p.text}
                    style={{
                        ...textBodyStyle,
                        flex: 1,
                        minHeight: 0,
                        resize: "none",
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        ...(p.textWrapMode === "nowrap" ? { overflowX: "auto", overflowY: "hidden" } : {}),
                        ...(!editorFontFamily ? { fontFamily: "inherit" } : {}),
                    }}
                    onInput={handleTextareaInput}
                    onBlur={handleTextareaBlur}
                    onKeyDown={handleTextareaKeyDown}
                />
            </div>
        );
    }

    return (
        <div style={outerStyle}>
            <p style={{ ...textBodyStyle, flexShrink: 0 }}>{p.text}</p>
        </div>
    );
}
