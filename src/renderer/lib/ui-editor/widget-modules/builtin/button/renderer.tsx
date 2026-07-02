import {
    Children,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ChangeEvent,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
} from "react";
import { motion } from "motion/react";
import { effectShadowStoredToCss } from "@shared/types/ui-editor/effects";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import {
    buttonResolvedVisualToRectangleLike,
    resolveButtonCursor,
    resolveButtonAppearanceTransitions,
    resolveButtonVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeElementState,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { beginInlineTextEdit } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { consumeSuppressNextCanvasWidgetDoubleClick } from "@/lib/ui-editor/interaction/containerDrillSelection";
import { getSingleSelectedElementId } from "@/lib/ui-editor/interaction/surfaceInlineTextEditActivation";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { toRuntimeMotionTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { firstTransitionForKeys } from "@/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { getButtonProps } from "./helpers";
import type { UIListElementExtra } from "@shared/types/ui-editor/list";
import {
    debugUIDoubleClick,
    describeDoubleClickTarget,
} from "@/lib/ui-editor/interaction/doubleClickDebug";

const OPENING_BLUR_GRACE_MS = 300;
import { BLUEPRINT_EVENTS_DISABLED_ATTR } from "@/lib/ui-editor/runtime/blueprintEventTargeting";

export function ButtonRenderer(props: WidgetRendererProps) {
    const { element, children, surface, hostAdapter, useAppearanceInspectorPreview } = props;
    const stateService = hostAdapter.editorStateService ?? UIEditorStateService.getInstance();
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

            if (wasHere || isHere || next?.kind === "textEdit") {
                debugUIDoubleClick("ButtonRenderer override", {
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
                draftRef.current = docEl ? getButtonProps(docEl).label : "";
            }

            if (wasHere && !isHere) {
                if (skipBlurCommitRef.current) {
                    skipBlurCommitRef.current = false;
                } else {
                    const docEl = documentService.getDocument().elements[element.id];
                    if (docEl) {
                        documentService.updateElementProps(element.id, {
                            ...docEl.props,
                            label: draftRef.current,
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
        debugUIDoubleClick("ButtonRenderer editing state", {
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
                debugUIDoubleClick("ButtonRenderer suppressed hierarchy drill doubleclick", {
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
                debugUIDoubleClick("ButtonRenderer ignored unfocused doubleclick", {
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
        draftRef.current = docEl ? getButtonProps(docEl).label : "";
    }, [isEditing, documentService, element.id]);

    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const p = getButtonProps(element);
    const interactionDisabled = Boolean(p.interactionDisabled);
    const runtimeState = useWidgetRuntimeElementState(element.id, interactionDisabled);
    const listScopedVariantId =
        typeof (element.extra as UIListElementExtra | undefined)?.runtimeVariantOverrideId === "string"
            ? (element.extra as UIListElementExtra).runtimeVariantOverrideId
            : null;
    const resolveCtx = {
        variantOverrideId: listScopedVariantId ?? runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeState.signals,
    };
    const v = resolveButtonVisualProps(element, p.appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveButtonAppearanceTransitions(p.appearance ?? undefined, resolveCtx);
    const rl = buttonResolvedVisualToRectangleLike(v);
    const rt = hostAdapter.blueprintRuntime;
    const canDispatchClick = Boolean(rt && !interactionDisabled);
    const resolvedCursor = resolveButtonCursor(v.cursor, interactionDisabled, canDispatchClick);
    const dispatchClick =
        canDispatchClick && !isEditing
            ? () => {
                  void rt!.dispatchElementBlueprintEvent(element.id, "mouseClick", {
                      x: Math.abs(element.layout.width) / 2,
                      y: Math.abs(element.layout.height) / 2,
                  });
              }
            : undefined;

    /** Padded shell: stretch children so label column can fill width/height. */
    const paddedShell: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        minHeight: 0,
    };

    const legacyChildrenCenter: CSSProperties = {
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    };
    const innerAnimate = {
        paddingTop: v.paddingY,
        paddingBottom: v.paddingY,
        paddingLeft: v.paddingX,
        paddingRight: v.paddingX,
    };
    const paddingTransition = firstTransitionForKeys(appearanceTransitions, ["paddingX", "paddingY"]);
    const innerTransition =
        paddingTransition != null
            ? {
                  paddingTop: toRuntimeMotionTransition(paddingTransition),
                  paddingBottom: toRuntimeMotionTransition(paddingTransition),
                  paddingLeft: toRuntimeMotionTransition(paddingTransition),
                  paddingRight: toRuntimeMotionTransition(paddingTransition),
              }
            : undefined;
    const paddingMotionActive = innerTransition != null;

    const onKeyDown = dispatchClick
        ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatchClick();
              }
          }
        : undefined;
    const blueprintEventRootProps = {
        [BLUEPRINT_EVENTS_DISABLED_ATTR]: interactionDisabled || isEditing ? "true" : undefined,
    } as Record<string, string | undefined>;

    const showLabel = p.label.trim().length > 0;
    const hasChildNodes = children != null && Children.count(children) > 0;

    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);
    const labelTextShadow = effectShadowStoredToCss(v.effects.effectTextShadow, "outer");
    const labelTypography: CSSProperties = {
        margin: 0,
        width: "100%",
        boxSizing: "border-box",
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color,
        textAlign: p.textAlign,
        lineHeight: p.lineHeight,
        ...lineWrapCss(p.textWrapMode),
        overflow: labelTextShadow ? "visible" : "hidden",
        ...(labelTextShadow ? { textShadow: labelTextShadow } : {}),
        ...(editorFontFamily ? { fontFamily: editorFontFamily } : {}),
    };

    const labelTextShadowTransition = firstTransitionForKeys(appearanceTransitions, ["effectTextShadow"]);
    const labelTextAnimate: Record<string, string> = {};
    const labelTextTransition: Record<string, unknown> = {};
    if (labelTextShadowTransition) {
        labelTextAnimate.textShadow = labelTextShadow || "none";
        labelTextTransition.textShadow = toRuntimeMotionTransition(labelTextShadowTransition);
    }
    const labelTextMotionActive = Object.keys(labelTextTransition).length > 0;

    const labelColumnStyle: CSSProperties = {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: textVerticalAlignToJustifyContent(p.textVerticalAlign),
        alignItems: "stretch",
    };

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const editOpenedAtRef = useRef(0);

    const commitLabelAndClose = useCallback(
        (nextLabel: string) => {
            draftRef.current = nextLabel;
            documentService.updateElementProps(element.id, {
                ...element.props,
                label: nextLabel,
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
            debugUIDoubleClick("ButtonRenderer textarea missing", {
                elementId: element.id,
                surfaceId: surface.id,
            });
            return;
        }
        debugUIDoubleClick("ButtonRenderer textarea focus", {
            elementId: element.id,
            surfaceId: surface.id,
        });
        el.focus();
        el.select();
    }, [isEditing]);

    const handleTextareaChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        draftRef.current = e.currentTarget.value;
    }, []);

    const handleTextareaKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                skipBlurCommitRef.current = true;
                debugUIDoubleClick("ButtonRenderer escape close", {
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
                debugUIDoubleClick("ButtonRenderer ignored transient blur", {
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
            debugUIDoubleClick("ButtonRenderer blur commit", {
                elementId: element.id,
                surfaceId: surface.id,
                openedMsAgo,
                relatedTarget: describeDoubleClickTarget(relatedTarget),
            });
            commitLabelAndClose(e.currentTarget.value);
        },
        [commitLabelAndClose, element.id, surface.id],
    );

    const labelBlock =
        showLabel || isEditing ? (
            <div style={labelColumnStyle}>
                {isEditing ? (
                    <textarea
                        ref={textareaRef}
                        defaultValue={p.label}
                        style={{
                            ...labelTypography,
                            flex: 1,
                            minHeight: 0,
                            resize: "none",
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            ...(p.textWrapMode === "nowrap" ? { overflowX: "auto", overflowY: "hidden" } : {}),
                            ...(!editorFontFamily ? { fontFamily: "inherit" } : {}),
                        }}
                        onChange={handleTextareaChange}
                        onBlur={handleTextareaBlur}
                        onKeyDown={handleTextareaKeyDown}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                    />
                ) : labelTextMotionActive ? (
                    <motion.p
                        style={{ ...labelTypography, flexShrink: 0 }}
                        initial={false}
                        animate={labelTextAnimate}
                        transition={labelTextTransition}
                    >
                        {p.label}
                    </motion.p>
                ) : (
                    <p style={{ ...labelTypography, flexShrink: 0 }}>{p.label}</p>
                )}
            </div>
        ) : null;

    const innerContent =
        showLabel || isEditing ? (
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                }}
            >
                {labelBlock}
                {hasChildNodes ? (
                    <div style={{ flexShrink: 0, minWidth: 0, display: "flex", justifyContent: "center", width: "100%" }}>
                        {children}
                    </div>
                ) : null}
            </div>
        ) : (
            <div style={legacyChildrenCenter}>{children}</div>
        );

    return (
        <RectangleChromeRenderer
            {...props}
            rectangleLike={rl}
            clipContent={v.clipContent}
            appearanceTransitions={appearanceTransitions}
            rootOpacityFactor={interactionDisabled ? 0.45 : 1}
            extraRootStyle={{
                position: "absolute",
                inset: 0,
                cursor: resolvedCursor,
            }}
            extraRootProps={{
                ...blueprintEventRootProps,
                role: canDispatchClick ? ("button" as const) : ("presentation" as const),
                tabIndex: canDispatchClick ? 0 : undefined,
                onKeyDown,
                onDoubleClick: handleStartInlineTextEdit,
            }}
        >
            {paddingMotionActive ? (
                <motion.div style={paddedShell} animate={innerAnimate} transition={innerTransition}>
                    {innerContent}
                </motion.div>
            ) : (
                <div
                    style={{
                        ...paddedShell,
                        paddingTop: v.paddingY,
                        paddingBottom: v.paddingY,
                        paddingLeft: v.paddingX,
                        paddingRight: v.paddingX,
                    }}
                >
                    {innerContent}
                </div>
            )}
        </RectangleChromeRenderer>
    );
}
