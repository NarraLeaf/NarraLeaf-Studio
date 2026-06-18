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
    type MouseEvent,
} from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import { beginInlineTextEdit } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { consumeSuppressNextCanvasWidgetDoubleClick } from "@/lib/ui-editor/interaction/containerDrillSelection";
import { getSingleSelectedElementId } from "@/lib/ui-editor/interaction/surfaceInlineTextEditActivation";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import { composeTextEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import { getTextProps } from "./helpers";
import {
    debugUIDoubleClick,
    describeDoubleClickTarget,
} from "@/lib/ui-editor/interaction/doubleClickDebug";

const OPENING_BLUR_GRACE_MS = 300;

export function TextRenderer({ element, surface, document, hostAdapter }: WidgetRendererProps) {
    const stateService = hostAdapter.editorStateService ?? UIEditorStateService.getInstance();
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

            if (wasHere || isHere || next?.kind === "textEdit") {
                debugUIDoubleClick("TextRenderer override", {
                    elementId: element.id,
                    surfaceId: surface.id,
                    wasHere,
                    isHere,
                    previous,
                    next,
                });
            }

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

    useEffect(() => {
        debugUIDoubleClick("TextRenderer editing state", {
            elementId: element.id,
            surfaceId: surface.id,
            isEditing,
            interactionOverride,
        });
    }, [element.id, interactionOverride, isEditing, surface.id]);

    const handleStartInlineTextEdit = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (isEditing || hostAdapter.blueprintRuntime) {
                return;
            }
            if (consumeSuppressNextCanvasWidgetDoubleClick()) {
                debugUIDoubleClick("TextRenderer suppressed hierarchy drill doubleclick", {
                    elementId: element.id,
                    surfaceId: surface.id,
                });
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const selection = stateService.getSelection();
            const selectionData = isUIElementSelection(selection) ? selection.data : null;
            const selectedSingleElementId = getSingleSelectedElementId(selectionData, surface.id);
            if (selectedSingleElementId !== element.id) {
                debugUIDoubleClick("TextRenderer ignored unfocused doubleclick", {
                    elementId: element.id,
                    surfaceId: surface.id,
                    selectedSingleElementId,
                });
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            beginInlineTextEdit(stateService, surface.id, element.id);
        },
        [element.id, hostAdapter.blueprintRuntime, isEditing, stateService, surface.id],
    );

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
    const editOpenedAtRef = useRef(0);

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
            editOpenedAtRef.current = 0;
            return;
        }
        editOpenedAtRef.current = performance.now();
        const el = textareaRef.current;
        if (!el) {
            debugUIDoubleClick("TextRenderer textarea missing", {
                elementId: element.id,
                surfaceId: surface.id,
            });
            return;
        }
        debugUIDoubleClick("TextRenderer textarea focus", {
            elementId: element.id,
            surfaceId: surface.id,
        });
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
                debugUIDoubleClick("TextRenderer escape close", {
                    elementId: element.id,
                    surfaceId: surface.id,
                });
                stateService.setInteractionOverride(null);
            }
        },
        [element.id, stateService, surface.id],
    );

    const handleTextareaBlur = useCallback(
        (e: FocusEvent<HTMLTextAreaElement>) => {
            if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
            }
            const openedMsAgo = editOpenedAtRef.current > 0 ? performance.now() - editOpenedAtRef.current : Infinity;
            const relatedTarget = e.relatedTarget instanceof Element ? e.relatedTarget : null;
            const relatedElementNode = relatedTarget?.closest("[data-ui-element-id]") as HTMLElement | null;
            const relatedInsideSameElement = relatedElementNode?.dataset.uiElementId === element.id;
            const relatedIsEditable = Boolean(relatedTarget?.closest("textarea, input, [contenteditable='true']"));
            const isOpeningBlur = openedMsAgo < OPENING_BLUR_GRACE_MS;
            const shouldKeepEditing = isOpeningBlur || (relatedIsEditable && relatedInsideSameElement);

            if (shouldKeepEditing) {
                debugUIDoubleClick("TextRenderer ignored transient blur", {
                    elementId: element.id,
                    surfaceId: surface.id,
                    openedMsAgo,
                    isOpeningBlur,
                    relatedIsEditable,
                    relatedInsideSameElement,
                    relatedTarget: describeDoubleClickTarget(relatedTarget),
                });
                if (!relatedInsideSameElement) {
                    requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (!el) {
                            return;
                        }
                        el.focus();
                        el.select();
                    });
                }
                return;
            }
            debugUIDoubleClick("TextRenderer blur commit", {
                elementId: element.id,
                surfaceId: surface.id,
                openedMsAgo,
                relatedTarget: describeDoubleClickTarget(relatedTarget),
            });
            commitAndClose(e.target.value);
        },
        [commitAndClose, element.id, surface.id],
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
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
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
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                    />
                )}
            </div>
        );
    }

    return (
        <div style={outerStyle} onDoubleClick={handleStartInlineTextEdit}>
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
