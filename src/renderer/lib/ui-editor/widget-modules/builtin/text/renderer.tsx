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
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import { composeTextEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import { getTextProps } from "./helpers";

export function TextRenderer({ element, surface, document }: WidgetRendererProps) {
    const stateService = UIEditorStateService.getInstance();
    const documentService = UIDocumentService.getInstance();
    useUIDocumentRevision(documentService);
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

    const liveElement = isEditing ? document.elements[element.id] ?? element : element;
    const p = getTextProps(liveElement);
    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);

    const effectTextStyle = composeTextEffectStyle(p.effects);
    // Filter / blend on a wrapper affect the subtree; text-shadow must live on the node that owns the glyphs.
    const useEffectShell = Boolean(effectTextStyle.filter) || Boolean(effectTextStyle.mixBlendMode);

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
        ...(effectTextStyle.textShadow ? { overflow: "visible" } : { overflow: "hidden" }),
        ...(editorFontFamily ? { fontFamily: editorFontFamily } : {}),
        ...(effectTextStyle.textShadow ? { textShadow: effectTextStyle.textShadow } : {}),
        ...(!useEffectShell && effectTextStyle.filter ? { filter: effectTextStyle.filter } : {}),
        ...(!useEffectShell && effectTextStyle.mixBlendMode ? { mixBlendMode: effectTextStyle.mixBlendMode } : {}),
    };

    const effectShellStyle: CSSProperties = useEffectShell
        ? {
              ...(effectTextStyle.filter ? { filter: effectTextStyle.filter } : {}),
              ...(effectTextStyle.mixBlendMode ? { mixBlendMode: effectTextStyle.mixBlendMode } : {}),
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              overflow: "visible",
          }
        : {};

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
            const docEl = documentService.getDocument().elements[element.id];
            documentService.updateElementProps(element.id, {
                ...(docEl?.props ?? element.props),
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
        const textareaStyle: CSSProperties = {
            ...textBodyStyle,
            flex: 1,
            minHeight: 0,
            resize: "none",
            background: "transparent",
            border: "none",
            outline: "none",
            ...(p.textWrapMode === "nowrap" ? { overflowX: "auto", overflowY: "hidden" } : {}),
            ...(!editorFontFamily ? { fontFamily: "inherit" } : {}),
        };
        return (
            <div style={outerStyle}>
                {useEffectShell ? (
                    <div style={effectShellStyle}>
                        <textarea
                            ref={textareaRef}
                            defaultValue={p.text}
                            style={textareaStyle}
                            onInput={handleTextareaInput}
                            onBlur={handleTextareaBlur}
                            onKeyDown={handleTextareaKeyDown}
                        />
                    </div>
                ) : (
                    <textarea
                        ref={textareaRef}
                        defaultValue={p.text}
                        style={textareaStyle}
                        onInput={handleTextareaInput}
                        onBlur={handleTextareaBlur}
                        onKeyDown={handleTextareaKeyDown}
                    />
                )}
            </div>
        );
    }

    return (
        <div style={outerStyle}>
            {useEffectShell ? (
                <div style={effectShellStyle}>
                    <p style={{ ...textBodyStyle, flexShrink: 0 }}>{p.text}</p>
                </div>
            ) : (
                <p style={{ ...textBodyStyle, flexShrink: 0 }}>{p.text}</p>
            )}
        </div>
    );
}
