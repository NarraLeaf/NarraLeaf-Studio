import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ChangeEvent,
    type FocusEvent,
    type FormEvent,
    type KeyboardEvent,
    type MouseEvent,
} from "react";
import { motion } from "motion/react";
import type { AppearanceFieldTransition } from "@shared/types/ui-editor/appearance";
import type { UIListElementExtra } from "@shared/types/ui-editor/list";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { useLocalizedWidgetText } from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
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
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import {
    resolveTextAppearanceTransitions,
    resolveTextVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeElementState,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { toRuntimeMotionTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { firstTransitionForKeys } from "@/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers";
import { composeTextEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import { getTextProps } from "./helpers";
import {
    debugUIDoubleClick,
    describeDoubleClickTarget,
} from "@/lib/ui-editor/interaction/doubleClickDebug";

const OPENING_BLUR_GRACE_MS = 300;
const TEXT_VALUE_PROP_PATH = "text";

function assignMotionTransition(
    target: Record<string, unknown>,
    property: string,
    transition: AppearanceFieldTransition | null
) {
    if (!transition) {
        return;
    }
    target[property] = toRuntimeMotionTransition(transition);
}

function commitTextEditValue(documentService: UIDocumentService, elementId: string, nextText: string): void {
    const docEl = documentService.getDocument().elements[elementId];
    if (docEl?.valueBindings?.[TEXT_VALUE_PROP_PATH]?.kind === "blueprintValue") {
        documentService.clearElementBlueprintValueBinding(elementId, TEXT_VALUE_PROP_PATH);
    }
    documentService.updateElementProps(elementId, {
        text: nextText,
    });
}

export function TextRenderer({
    element,
    surface,
    hostAdapter,
    useAppearanceInspectorPreview,
}: WidgetRendererProps) {
    const stateService = hostAdapter.editorStateService ?? UIEditorStateService.getInstance();
    const documentService = hostAdapter.editorDocumentService ?? UIDocumentService.getInstance();
    useUIDocumentRevision(documentService);
    const initialText = getTextProps(element).text;
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());
    const [draftText, setDraftText] = useState(initialText);
    const draftRef = useRef(initialText);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const editOpenedAtRef = useRef(0);
    const skipBlurCommitRef = useRef(false);
    const skipOverrideCommitRef = useRef(false);

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
                const nextDraft = getTextProps(documentService.getDocument().elements[element.id] ?? element).text;
                draftRef.current = nextDraft;
                setDraftText(nextDraft);
            }

            if (wasHere && !isHere) {
                if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                } else if (skipOverrideCommitRef.current) {
                    skipOverrideCommitRef.current = false;
                } else {
                    const currentText = textareaRef.current?.value ?? draftRef.current;
                    draftRef.current = currentText;
                    setDraftText(currentText);
                    commitTextEditValue(documentService, element.id, currentText);
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
        if (isEditing) {
            return;
        }
        const nextDraft = getTextProps(element).text;
        draftRef.current = nextDraft;
        setDraftText(nextDraft);
    }, [element, isEditing]);

    const flatProps = getTextProps(element);
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const runtimeState = useWidgetRuntimeElementState(element.id);
    const listScopedVariantId =
        typeof (element.extra as UIListElementExtra | undefined)?.runtimeVariantOverrideId === "string"
            ? (element.extra as UIListElementExtra).runtimeVariantOverrideId
            : null;
    const resolveCtx = {
        variantOverrideId: listScopedVariantId ?? runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeState.signals,
    };
    const p = resolveTextVisualProps(element, flatProps.appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveTextAppearanceTransitions(flatProps.appearance ?? undefined, resolveCtx);
    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);
    // Localized display text (runtime only; design time and inline editing keep the source text).
    const displayText = useLocalizedWidgetText({
        elementId: element.id,
        prop: "text",
        sourceText: p.text,
        localizable: flatProps.localizable,
        localizationKey: flatProps.localizationKey,
    });

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
        fontStyle: p.fontStyle,
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

    const tx = Number.isFinite(p.transformOffsetX) ? p.transformOffsetX : 0;
    const ty = Number.isFinite(p.transformOffsetY) ? p.transformOffsetY : 0;
    const ts = Number.isFinite(p.transformScale) && p.transformScale > 0 ? p.transformScale : 1;
    const tr = Number.isFinite(p.transformRotation) ? p.transformRotation : 0;
    const transformCss = `translate(${tx}px, ${ty}px) scale(${ts}) rotate(${tr}deg)`;

    const rootAnimate: Record<string, string | number> = {
        x: tx,
        y: ty,
        scale: ts,
        rotate: tr,
        opacity: 1,
    };
    const rootTransition: Record<string, unknown> = {};
    assignMotionTransition(
        rootTransition,
        "x",
        firstTransitionForKeys(appearanceTransitions, ["transformOffsetX"])
    );
    assignMotionTransition(
        rootTransition,
        "y",
        firstTransitionForKeys(appearanceTransitions, ["transformOffsetY"])
    );
    assignMotionTransition(
        rootTransition,
        "scale",
        firstTransitionForKeys(appearanceTransitions, ["transformScale"])
    );
    assignMotionTransition(
        rootTransition,
        "rotate",
        firstTransitionForKeys(appearanceTransitions, ["transformRotation"])
    );
    const rootMotionActive = Object.keys(rootTransition).length > 0;

    const textAnimate: Record<string, string | number> = {
        fontSize: p.fontSize,
        color,
        lineHeight: p.lineHeight,
    };
    const textTransition: Record<string, unknown> = {};
    assignMotionTransition(textTransition, "fontSize", firstTransitionForKeys(appearanceTransitions, ["fontSize"]));
    assignMotionTransition(textTransition, "color", firstTransitionForKeys(appearanceTransitions, ["color"]));
    assignMotionTransition(textTransition, "lineHeight", firstTransitionForKeys(appearanceTransitions, ["lineHeight"]));
    const textShadowTransition = firstTransitionForKeys(appearanceTransitions, ["effectTextShadow"]);
    if (textShadowTransition) {
        textAnimate.textShadow = effectTextStyle.textShadow ?? "none";
        assignMotionTransition(textTransition, "textShadow", textShadowTransition);
    }

    const shellAnimate: Record<string, string> = {};
    const shellTransition: Record<string, unknown> = {};
    const filterTransition = firstTransitionForKeys(appearanceTransitions, ["effectBlur", "effectFilter"]);
    if (useEffectShell && filterTransition) {
        shellAnimate.filter = effectTextStyle.filter ?? "none";
        assignMotionTransition(shellTransition, "filter", filterTransition);
    } else if (!useEffectShell && filterTransition) {
        textAnimate.filter = effectTextStyle.filter ?? "none";
        assignMotionTransition(textTransition, "filter", filterTransition);
    }
    const shellMotionActive = Object.keys(shellTransition).length > 0;
    const textMotionActive = Object.keys(textTransition).length > 0;

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
    const outerStaticStyle: CSSProperties = {
        ...outerStyle,
        transform: transformCss,
        opacity: 1,
    };

    const commitAndClose = useCallback(
        (nextText: string) => {
            draftRef.current = nextText;
            setDraftText(nextText);
            commitTextEditValue(documentService, element.id, nextText);
            skipOverrideCommitRef.current = true;
            stateService.setInteractionOverride(null);
        },
        [documentService, element.id, stateService],
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

    const updateDraftFromTextarea = useCallback((value: string) => {
        draftRef.current = value;
        setDraftText(value);
    }, []);

    const handleTextareaChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        updateDraftFromTextarea(e.currentTarget.value);
    }, [updateDraftFromTextarea]);

    const handleTextareaInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
        updateDraftFromTextarea(e.currentTarget.value);
    }, [updateDraftFromTextarea]);

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
            draftRef.current = e.currentTarget.value;
            debugUIDoubleClick("TextRenderer blur commit", {
                elementId: element.id,
                surfaceId: surface.id,
                openedMsAgo,
                relatedTarget: describeDoubleClickTarget(relatedTarget),
            });
            commitAndClose(e.currentTarget.value);
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
        const textarea = (
            <textarea
                ref={textareaRef}
                value={draftText}
                style={textareaStyle}
                onInput={handleTextareaInput}
                onChange={handleTextareaChange}
                onBlur={handleTextareaBlur}
                onKeyDown={handleTextareaKeyDown}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
            />
        );
        const editingInner = useEffectShell ? (
            shellMotionActive ? (
                <motion.div style={effectShellStyle} initial={false} animate={shellAnimate} transition={shellTransition}>
                    {textarea}
                </motion.div>
            ) : (
                <div style={effectShellStyle}>{textarea}</div>
            )
        ) : (
            textarea
        );
        const editingContent = rootMotionActive ? (
            <motion.div style={outerStyle} initial={false} animate={rootAnimate} transition={rootTransition}>
                {editingInner}
            </motion.div>
        ) : (
            <div style={outerStaticStyle}>{editingInner}</div>
        );
        return (
            editingContent
        );
    }

    const textNode = textMotionActive ? (
        <motion.p
            style={{ ...textBodyStyle, flexShrink: 0 }}
            initial={false}
            animate={textAnimate}
            transition={textTransition}
        >
            {displayText}
        </motion.p>
    ) : (
        <p style={{ ...textBodyStyle, flexShrink: 0 }}>{displayText}</p>
    );

    const effectNode = useEffectShell ? (
        shellMotionActive ? (
            <motion.div style={effectShellStyle} initial={false} animate={shellAnimate} transition={shellTransition}>
                {textNode}
            </motion.div>
        ) : (
            <div style={effectShellStyle}>{textNode}</div>
        )
    ) : (
        textNode
    );

    return (
        rootMotionActive ? (
            <motion.div
                style={outerStyle}
                initial={false}
                animate={rootAnimate}
                transition={rootTransition}
                onDoubleClick={handleStartInlineTextEdit}
            >
                {effectNode}
            </motion.div>
        ) : (
            <div style={outerStaticStyle} onDoubleClick={handleStartInlineTextEdit}>
                {effectNode}
            </div>
        )
    );
}
