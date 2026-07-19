import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { Image as ImageIcon, Keyboard as KeyboardIcon, Link2, Minus, Plus, X } from "lucide-react";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT,
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintInspectorParamDef,
    type BlueprintInspectorParamSelectOption,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { BlueprintLiteralValueControl, type LiteralEditMode } from "../../components/BlueprintLiteralValueControl";
import { BlueprintJsonValueControl } from "../../components/BlueprintJsonValueControl";
import { BlueprintColorValueControl } from "../../components/BlueprintColorValueControl";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { Button, Input, TextArea } from "@/lib/components/elements";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    formatBlueprintKeyboardBinding,
    formatBlueprintKeyboardBindingFromEvent,
    normalizeBlueprintKeyboardEventKeyName,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
    BLUEPRINT_VALUE_TYPE_TIMER,
    normalizeBlueprintImageAssetValue,
    type BlueprintImageAsset,
} from "@shared/types/blueprint/valueTypes";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { ButtonCursorSelect } from "@/lib/ui-editor/widget-modules/shared/appearance/editors/ButtonCursorSelect";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "../../blueprintNodeI18n";

type BlueprintNodeParamHistoryOptions = { mergeKey?: string; mergeWindowMs?: number };
type BlueprintNodeParamPatch = (
    nodeId: string,
    key: string,
    value: unknown,
    history?: BlueprintNodeParamHistoryOptions,
) => void;

export type BlueprintFlowNodeDiagnostic = {
    severity: "error" | "warning" | "info";
    message: string;
    code?: string;
};

/**
 * React Flow handles node selection / drag on pointer down. Stopping propagation on click alone is too late;
 * use this on embedded controls so the node stays selected and the pane does not steal the interaction.
 */
function stopFlowNodePointerBubble(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

export type BlueprintFlowNodeData = {
    catalog: BlueprintNodeEditorCatalogEntry;
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam?: BlueprintNodeParamPatch;
    /** Append a variadic data input pin (IR + params). */
    onAddDynamicInputPin?: (nodeId: string) => void;
    /** Remove a user-added input pin and clean edges / literals. */
    onRemoveDynamicInputPin?: (nodeId: string, pinId: string) => void;
    /** Accessible variables for variableRef inspector controls. */
    memberVariables?: Array<{
        id: string;
        name: string;
        value: string;
        valueType?: string;
        disambiguationLabel?: string;
    }>;
    /** Project-level persistent variables for persistentVariableRef inspector controls. */
    persistentVariables?: Array<{
        id: string;
        name: string;
        value: string;
        valueType?: string;
    }>;
    /** Input ports that have an incoming edge (any semantic). */
    wiredInputPortIds?: ReadonlySet<string>;
    /**
     * Dynamic select options keyed by `dynamicOptionsSource` id.
     * Populated by the flow projection from workspace context (e.g. available surfaces).
     */
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
    /** Diagnostics targeted at this node in the active graph. */
    nodeDiagnostics?: readonly BlueprintFlowNodeDiagnostic[];
    /** Current UIDocument preview for bound Element Literal nodes. */
    elementPreview?: {
        revisionKey?: string;
        name: string;
        type: string;
        text?: string;
        layout?: { width: number; height: number };
        preview?: ReactNode;
    };
    /** Static Variant choices for Displayable Set Variant cards when the target can be inferred. */
    displayableTargetVariants?: {
        supported: boolean;
        targetLabel?: string;
        options: BlueprintInspectorParamSelectOption[];
        message?: string;
    };
    /** Starts the temporary same-Surface element binding flow for Element Literal nodes. */
    onBindElementLiteral?: (nodeId: string) => void;
};

const EXEC_HANDLE_CLASS = "!h-2 !w-2 !border border-edge-strong !bg-cyan-500";
const DATA_HANDLE_CLASS = "!h-2 !w-2 !border border-amber-200/35 !bg-amber-500";
const PIN_LABEL_CLASS = "text-fg-muted";
const OPTIONAL_UNWIRED_PIN_LABEL_CLASS = "text-fg-subtle italic";

const CARD_INPUT =
    "rounded border-edge bg-surface px-1.5 py-1 font-mono text-2xs";
const CARD_ICON_BUTTON =
    "nodrag !h-4 !w-4 shrink-0 !gap-0 rounded !p-0.5 text-fg-muted hover:bg-fill-subtle hover:text-fg-muted";

/** Hide native number steppers — keep same look as other card fields (WebKit + Firefox). */
const INPUT_NUMBER_NO_SPINNER =
    "[-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0";

/** Pin body: fixed min width, cap max — avoid equal flex-1 columns hollowing the middle on inline inputs. */
const BLUEPRINT_CARD_PIN_BODY_CLASS = "min-w-[200px] max-w-[280px]";
const COMMENT_DEFAULT_WIDTH = 360;
const COMMENT_DEFAULT_HEIGHT = 180;

function useImageAssetDisplayName(assetId: string | null): string | null {
    let context: ReturnType<typeof useWorkspace>["context"] | null = null;
    try {
        context = useWorkspace().context;
    } catch {
        context = null;
    }
    return useMemo(() => {
        if (!assetId || !context) {
            return null;
        }
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        return assetsService.getAssets()[AssetType.Image]?.[assetId]?.name ?? null;
    }, [assetId, context]);
}

function ImageAssetPickerCard({
    value,
    onChange,
    disabled = false,
    compact = false,
}: {
    value: unknown;
    onChange?: (value: BlueprintImageAsset | null) => void;
    disabled?: boolean;
    compact?: boolean;
}) {
    const { t } = useTranslation();
    const normalized = normalizeBlueprintImageAssetValue(value);
    const assetId = normalized?.assetId ?? null;
    const assetName = useImageAssetDisplayName(assetId);
    const { url, loading, error } = useAssetObjectUrl(assetId);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const label = assetId ? assetName ?? t("blueprint.image.fallback") : t("blueprint.image.select");
    // "ImageAsset" is the value-type token shown when a valid asset is bound; it stays untranslated.
    const detail = assetId ? (error ? t("blueprint.image.missing") : "ImageAsset") : t("blueprint.image.none");
    const heightClass = compact ? "h-[58px]" : "h-[82px]";

    const handleConfirm = (assets: Asset[]) => {
        const selected = assets[0];
        onChange?.(selected ? { kind: "imageAsset", assetId: selected.id } : null);
        setSelectorOpen(false);
    };

    return (
        <div
            className="nodrag min-w-0"
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
        >
            <div className="relative">
                <button
                    ref={anchorRef}
                    type="button"
                    disabled={disabled}
                    className={`group relative flex w-full min-w-0 overflow-hidden rounded border border-edge bg-surface text-left transition-colors ${
                        disabled ? "cursor-default opacity-80" : "hover:border-primary/35 hover:bg-fill-subtle"
                    } ${heightClass}`}
                    title={assetId ? `${label} (${assetId})` : t("blueprint.image.selectAsset")}
                    onClick={e => {
                        e.stopPropagation();
                        if (!disabled) {
                            setSelectorOpen(true);
                        }
                    }}
                >
                    <div className="relative h-full w-[74px] shrink-0 overflow-hidden bg-black/25">
                        {url ? (
                            <img
                                src={url}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                draggable={false}
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                                <ImageIcon className="h-5 w-5" aria-hidden />
                            </div>
                        )}
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-2xs text-white">
                                {t("common.loading")}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1">
                        <div className="truncate text-2xs font-medium text-fg">{label}</div>
                        <div className={`truncate text-2xs ${error ? "text-warning" : "text-fg-subtle"}`}>
                            {detail}
                        </div>
                    </div>
                    {!disabled ? (
                        <div className="pointer-events-none absolute inset-0 bg-primary/0 transition-colors group-hover:bg-primary/[0.04]" />
                    ) : null}
                </button>
                {assetId && !disabled ? (
                    <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-black/55 p-0.5 text-white/80 hover:bg-black/80 hover:text-white"
                        title={t("blueprint.image.clear")}
                        aria-label={t("blueprint.image.clear")}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            onChange?.(null);
                        }}
                    >
                        <X className="h-3 w-3" aria-hidden />
                    </button>
                ) : null}
            </div>
            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={anchorRef}
                title={t("blueprint.image.selectAssetTitle")}
                multiple={false}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleConfirm}
            />
        </div>
    );
}

const COMMENT_COLORS: Record<
    string,
    {
        border: string;
        selectedBorder: string;
        background: string;
        header: string;
        text: string;
        swatch: string;
    }
> = {
    amber: {
        border: "rgba(245, 158, 11, 0.55)",
        selectedBorder: "rgba(251, 191, 36, 0.95)",
        background: "rgba(120, 78, 18, 0.28)",
        header: "rgba(245, 158, 11, 0.2)",
        text: "#fde68a",
        swatch: "#f59e0b",
    },
    cyan: {
        border: "rgba(34, 211, 238, 0.55)",
        selectedBorder: "rgba(103, 232, 249, 0.95)",
        background: "rgba(8, 85, 102, 0.28)",
        header: "rgba(34, 211, 238, 0.18)",
        text: "#a5f3fc",
        swatch: "#06b6d4",
    },
    violet: {
        border: "rgba(167, 139, 250, 0.55)",
        selectedBorder: "rgba(196, 181, 253, 0.95)",
        background: "rgba(76, 29, 149, 0.26)",
        header: "rgba(167, 139, 250, 0.18)",
        text: "#ddd6fe",
        swatch: "#8b5cf6",
    },
    slate: {
        border: "rgba(148, 163, 184, 0.5)",
        selectedBorder: "rgba(203, 213, 225, 0.92)",
        background: "rgba(51, 65, 85, 0.32)",
        header: "rgba(148, 163, 184, 0.13)",
        text: "#e2e8f0",
        swatch: "#64748b",
    },
};

/** Localized swatch labels for comment colors, keyed by the same ids as {@link COMMENT_COLORS}. */
function commentColorLabel(key: string, t: UseTranslation["t"]): string {
    switch (key) {
        case "amber":
            return t("blueprint.comment.color.amber");
        case "cyan":
            return t("blueprint.comment.color.cyan");
        case "violet":
            return t("blueprint.comment.color.violet");
        case "slate":
            return t("blueprint.comment.color.slate");
        default:
            return key;
    }
}

type CatalogPin = BlueprintNodeEditorCatalogEntry["pins"][number] & { removable?: boolean };

function readOpenInlineLiteralPinIds(params: Record<string, unknown>): Set<string> {
    const raw = params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY];
    if (!Array.isArray(raw)) {
        return new Set();
    }
    return new Set(raw.filter((x): x is string => typeof x === "string"));
}

function readDynamicPinLabelValues(params: Record<string, unknown>, key: string | undefined): Record<string, string> {
    if (!key) {
        return {};
    }
    const raw = params[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [pinId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim().length > 0) {
            out[pinId] = value.trim();
        }
    }
    return out;
}

function pinLabelOnly(pin: CatalogPin, t: UseTranslation["t"]): string {
    const raw = pin.label?.trim();
    return raw ? resolveBlueprintLabel(raw, t) : pin.id;
}

function pinCaption(pin: CatalogPin, semantic: "exec" | "data", t: UseTranslation["t"]): string {
    const name = pinLabelOnly(pin, t);
    if (semantic === "data" && pin.valueType && pin.valueType !== "any") {
        return `${name} · ${pin.valueType}`;
    }
    return name;
}

function pinLabelClass(pin: Pick<CatalogPin, "optional">, isWired: boolean): string {
    return pin.optional === true && !isWired ? OPTIONAL_UNWIRED_PIN_LABEL_CLASS : PIN_LABEL_CLASS;
}

function DynamicPinLabelInput({
    pin,
    nodeId,
    labelParamKey,
    labels,
    onPatchNodeParam,
}: {
    pin: CatalogPin;
    nodeId: string;
    labelParamKey: string;
    labels: Record<string, string>;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
}) {
    const { t } = useTranslation();
    const committed = labels[pin.id] ?? pinLabelOnly(pin, t);
    const [draft, setDraft] = useState(committed);

    useEffect(() => {
        setDraft(committed);
    }, [committed]);

    const isInvalid = useMemo(() => {
        const next = draft.trim();
        return (
            next.length === 0 ||
            Object.entries(labels).some(([id, label]) => id !== pin.id && label.trim() === next)
        );
    }, [draft, labels, pin.id]);

    return (
        <Input
            className={`nodrag ${CARD_INPUT} min-h-[20px] min-w-[5rem] max-w-[8rem] flex-1 py-0.5 ${
                isInvalid ? "border-danger/70 text-danger" : ""
            }`}
            type="text"
            value={draft}
            size="sm"
            title={isInvalid ? t("blueprint.json.fieldNameInvalid") : t("blueprint.pin.jsonFieldName")}
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
            onChange={e => {
                const nextDraft = e.target.value;
                setDraft(nextDraft);
                const nextLabel = nextDraft.trim();
                const duplicate = Object.entries(labels).some(
                    ([id, label]) => id !== pin.id && label.trim() === nextLabel,
                );
                if (!nextLabel || duplicate) {
                    return;
                }
                onPatchNodeParam(nodeId, labelParamKey, { ...labels, [pin.id]: nextLabel });
            }}
        />
    );
}

function DynamicPinTypeSelect({
    pin,
    nodeId,
    typeParamKey,
    types,
    typeOptions,
    fallbackValueType,
    onPatchNodeParam,
}: {
    pin: CatalogPin;
    nodeId: string;
    typeParamKey: string;
    types: Record<string, string>;
    typeOptions: readonly string[];
    fallbackValueType?: string;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
}) {
    const current = types[pin.id] ?? pin.valueType ?? fallbackValueType ?? typeOptions[0] ?? "any";
    return (
        <div
            className="nodrag shrink-0"
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
        >
            <Select
                size="sm"
                className="min-w-[4.5rem]"
                options={typeOptions.map(t => ({ value: t, label: t }))}
                value={current}
                onChange={value => {
                    onPatchNodeParam(nodeId, typeParamKey, { ...types, [pin.id]: String(value) });
                }}
                portalMenu
                menuPlacement="below"
            />
        </div>
    );
}

/**
 * On-card true/false dropdown for an unwired boolean data pin. An unset pin reads as False,
 * matching the runtime, which treats anything other than `true` as false.
 */
function PinInlineBooleanSelect({
    pin,
    nodeId,
    raw,
    onPatchNodeParam,
}: {
    pin: CatalogPin;
    nodeId: string;
    raw: unknown;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            className="nodrag min-w-0 flex-1"
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
        >
            <Select
                size="sm"
                fullWidth
                options={[
                    { value: "true", label: t("blueprint.literal.true") },
                    { value: "false", label: t("blueprint.literal.false") },
                ]}
                value={raw === true ? "true" : "false"}
                onChange={value => onPatchNodeParam(nodeId, pin.id, value === "true")}
                portalMenu
                menuPlacement="below"
            />
        </div>
    );
}

function PinInlineLiteralInput({
    pin,
    nodeId,
    params,
    onPatchNodeParam,
    className,
}: {
    pin: CatalogPin;
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
    className?: string;
}) {
    const vt = pin.valueType;
    const raw = pin.id in params ? params[pin.id] : undefined;
    // `nodrag` exempts the field from React Flow node dragging (native d3-drag listeners
    // ignore React's stopPropagation, so text-selection drags would otherwise move the card).
    const baseClass = `nodrag ${className ?? CARD_INPUT}`;
    const numberClass = `${baseClass} ${INPUT_NUMBER_NO_SPINNER}`.trim();

    if (vt === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET || vt === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE) {
        return (
            <div className="min-w-0 flex-1">
                <ImageAssetPickerCard
                    value={raw}
                    compact
                    onChange={value => onPatchNodeParam(nodeId, pin.id, value)}
                />
            </div>
        );
    }

    if (vt === "boolean") {
        return <PinInlineBooleanSelect pin={pin} nodeId={nodeId} raw={raw} onPatchNodeParam={onPatchNodeParam} />;
    }

    if (vt === "string") {
        return (
            <div className="min-w-0 flex-1">
                <Input
                    className={baseClass}
                    type="text"
                    value={raw !== undefined && raw !== null ? String(raw) : ""}
                    size="sm"
                    fullWidth
                    onMouseDown={stopFlowNodePointerBubble}
                    onPointerDown={stopFlowNodePointerBubble}
                    onChange={e => {
                        const t = e.target.value;
                        onPatchNodeParam(nodeId, pin.id, t.length > 0 ? t : undefined);
                    }}
                />
            </div>
        );
    }

    if (vt === "integer") {
        return (
            <div className="min-w-0 flex-1">
                <Input
                    className={numberClass}
                    type="number"
                    step={1}
                    value={typeof raw === "number" && Number.isFinite(raw) ? raw : raw === undefined ? "" : String(raw)}
                    size="sm"
                    fullWidth
                    onMouseDown={stopFlowNodePointerBubble}
                    onPointerDown={stopFlowNodePointerBubble}
                    onChange={e => {
                        const t = e.target.value.trim();
                        if (!t) {
                            onPatchNodeParam(nodeId, pin.id, undefined);
                            return;
                        }
                        const n = parseInt(t, 10);
                        onPatchNodeParam(nodeId, pin.id, Number.isFinite(n) ? n : undefined);
                    }}
                />
            </div>
        );
    }

    if (vt === "float") {
        return (
            <div className="min-w-0 flex-1">
                <Input
                    className={numberClass}
                    type="number"
                    step="any"
                    value={typeof raw === "number" && Number.isFinite(raw) ? raw : raw === undefined ? "" : String(raw)}
                    size="sm"
                    fullWidth
                    onMouseDown={stopFlowNodePointerBubble}
                    onPointerDown={stopFlowNodePointerBubble}
                    onChange={e => {
                        const t = e.target.value.trim();
                        if (!t) {
                            onPatchNodeParam(nodeId, pin.id, undefined);
                            return;
                        }
                        const n = Number(t);
                        onPatchNodeParam(nodeId, pin.id, Number.isFinite(n) ? n : undefined);
                    }}
                />
            </div>
        );
    }

    return null;
}

function InputPinRow({
    pin,
    semantic,
    selected,
    nodeId,
    params,
    onPatchNodeParam,
    isWired,
    removable,
    onRemovePin,
    dynamicLabelParamKey,
    dynamicLabelValues,
    dynamicTypeParamKey,
    dynamicTypeValues,
    dynamicTypeOptions,
}: {
    pin: CatalogPin;
    semantic: "exec" | "data";
    selected: boolean;
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam?: (nodeId: string, key: string, value: unknown) => void;
    isWired: boolean;
    removable?: boolean;
    onRemovePin?: (nodeId: string, pinId: string) => void;
    dynamicLabelParamKey?: string;
    dynamicLabelValues: Record<string, string>;
    dynamicTypeParamKey?: string;
    dynamicTypeValues?: Record<string, string>;
    dynamicTypeOptions?: readonly string[];
}) {
    const { t } = useTranslation();
    const typeEditor =
        removable && dynamicTypeParamKey && dynamicTypeOptions?.length && onPatchNodeParam ? (
            <DynamicPinTypeSelect
                pin={pin}
                nodeId={nodeId}
                typeParamKey={dynamicTypeParamKey}
                types={dynamicTypeValues ?? {}}
                typeOptions={dynamicTypeOptions}
                onPatchNodeParam={onPatchNodeParam}
            />
        ) : null;
    const handleClass = semantic === "exec" ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS;
    const labelClass = pinLabelClass(pin, isWired);
    const canInlineLiteral =
        semantic === "data" &&
        Boolean(pin.allowInlineLiteral) &&
        Boolean(onPatchNodeParam) &&
        !isWired;
    const openPins = readOpenInlineLiteralPinIds(params);
    const inlineOpen = openPins.has(pin.id);
    const showInlineEditor = canInlineLiteral && inlineOpen;

    const toggleInlineLiteral = () => {
        if (!onPatchNodeParam || !canInlineLiteral) {
            return;
        }
        const next = new Set(openPins);
        if (next.has(pin.id)) {
            next.delete(pin.id);
        } else {
            next.add(pin.id);
        }
        onPatchNodeParam(
            nodeId,
            BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
            next.size > 0 ? [...next] : undefined,
        );
    };

    // Inline literal replaces the pin row (no handle / label); same vertical slot as the pin.
    if (showInlineEditor && onPatchNodeParam) {
        const labelEditor =
            removable && dynamicLabelParamKey ? (
                <DynamicPinLabelInput
                    pin={pin}
                    nodeId={nodeId}
                    labelParamKey={dynamicLabelParamKey}
                    labels={dynamicLabelValues}
                    onPatchNodeParam={onPatchNodeParam}
                />
            ) : (
                <span
                    className={`shrink-0 text-2xs leading-tight ${labelClass}`}
                    title={pinLabelOnly(pin, t)}
                >
                    {pinLabelOnly(pin, t)}
                </span>
            );
        return (
            <div className="relative flex min-h-[20px] w-full min-w-0 items-center gap-0.5 pl-1 pr-0.5">
                <div className="flex min-w-0 flex-1 items-center gap-1 pl-3.5">
                    {removable && onRemovePin ? (
                        <Button
                            type="button"
                            title={t("blueprint.pin.removeInput")}
                            aria-label={t("blueprint.pin.removeInput")}
                            variant="ghost"
                            size="sm"
                            className={`${CARD_ICON_BUTTON} text-fg-subtle`}
                            onMouseDown={stopFlowNodePointerBubble}
                            onPointerDown={stopFlowNodePointerBubble}
                            onClick={e => {
                                e.stopPropagation();
                                onRemovePin(nodeId, pin.id);
                            }}
                        >
                            <Minus className="h-3 w-3" aria-hidden />
                        </Button>
                    ) : null}
                    {labelEditor}
                    {typeEditor}
                    <PinInlineLiteralInput
                        pin={pin}
                        nodeId={nodeId}
                        params={params}
                        onPatchNodeParam={onPatchNodeParam}
                        className={`${CARD_INPUT} min-h-[20px] min-w-0 flex-1 py-0.5`}
                    />
                    <Button
                        type="button"
                        title={t("blueprint.pin.showInput")}
                        aria-label={t("blueprint.pin.showInput")}
                        variant="ghost"
                        size="sm"
                        className={CARD_ICON_BUTTON}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            toggleInlineLiteral();
                        }}
                    >
                        <Link2 className="h-3 w-3" aria-hidden />
                    </Button>
                </div>
            </div>
        );
    }

    // Per-row anonymous `group` so `group-hover` is scoped to this pin row (reliable inside React Flow nodes).
    // Label + inline-literal button share one cluster (gap-0.5) so the icon sits next to text, not at the column edge.
    const labelEditor =
        removable && dynamicLabelParamKey && onPatchNodeParam ? (
            <DynamicPinLabelInput
                pin={pin}
                nodeId={nodeId}
                labelParamKey={dynamicLabelParamKey}
                labels={dynamicLabelValues}
                onPatchNodeParam={onPatchNodeParam}
            />
        ) : (
            <span
                className={`min-w-0 shrink truncate text-2xs leading-tight ${labelClass}`}
                title={pinCaption(pin, semantic, t)}
            >
                {pinCaption(pin, semantic, t)}
            </span>
        );
    return (
        <div className="group relative flex min-h-[20px] w-full min-w-0 items-center pl-1 pr-0.5">
            <Handle
                type="target"
                position={Position.Left}
                id={pin.id}
                className={`${handleClass} !left-0 !top-1/2 !-translate-y-1/2`}
                title={pinCaption(pin, semantic, t)}
            />
            <div className="flex min-w-0 flex-1 items-center pl-3.5">
                <div className="flex min-w-0 max-w-full items-center gap-0.5">
                    {removable && onRemovePin ? (
                        <Button
                            type="button"
                            title={t("blueprint.pin.removeInput")}
                            aria-label={t("blueprint.pin.removeInput")}
                            variant="ghost"
                            size="sm"
                            className={`${CARD_ICON_BUTTON} text-fg-subtle`}
                            onMouseDown={stopFlowNodePointerBubble}
                            onPointerDown={stopFlowNodePointerBubble}
                            onClick={e => {
                                e.stopPropagation();
                                onRemovePin(nodeId, pin.id);
                            }}
                        >
                            <Minus className="h-3 w-3" aria-hidden />
                        </Button>
                    ) : null}
                    {labelEditor}
                    {typeEditor}
                    {canInlineLiteral && selected ? (
                        <Button
                            type="button"
                            title={t("blueprint.pin.editValue")}
                            aria-label={t("blueprint.pin.editValue")}
                            variant="ghost"
                            size="sm"
                            className={`${CARD_ICON_BUTTON} opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100`}
                            onMouseDown={stopFlowNodePointerBubble}
                            onPointerDown={stopFlowNodePointerBubble}
                            onClick={e => {
                                e.stopPropagation();
                                toggleInlineLiteral();
                            }}
                        >
                            <Link2 className="h-3 w-3" aria-hidden />
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function OutputPinRow({
    pin,
    semantic,
    nodeId,
    onPatchNodeParam,
    removable,
    onRemovePin,
    dynamicLabelParamKey,
    dynamicLabelValues,
    dynamicTypeParamKey,
    dynamicTypeValues,
    dynamicTypeOptions,
}: {
    pin: CatalogPin;
    semantic: "exec" | "data";
    nodeId?: string;
    onPatchNodeParam?: (nodeId: string, key: string, value: unknown) => void;
    removable?: boolean;
    onRemovePin?: (nodeId: string, pinId: string) => void;
    dynamicLabelParamKey?: string;
    dynamicLabelValues?: Record<string, string>;
    dynamicTypeParamKey?: string;
    dynamicTypeValues?: Record<string, string>;
    dynamicTypeOptions?: readonly string[];
}) {
    const { t } = useTranslation();
    const handleClass = semantic === "exec" ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS;
    const editable = Boolean(removable && nodeId && onPatchNodeParam);
    if (editable && nodeId && onPatchNodeParam) {
        // Editable dynamic output pin (e.g. Fn head parameters): remove + rename + type cluster.
        return (
            <div className="relative flex min-h-[20px] w-full min-w-0 items-center justify-end gap-0.5 pl-0.5 pr-1">
                {onRemovePin ? (
                    <Button
                        type="button"
                        title={t("blueprint.pin.removeOutput")}
                        aria-label={t("blueprint.pin.removeOutput")}
                        variant="ghost"
                        size="sm"
                        className={`${CARD_ICON_BUTTON} text-fg-subtle`}
                        onMouseDown={stopFlowNodePointerBubble}
                        onPointerDown={stopFlowNodePointerBubble}
                        onClick={e => {
                            e.stopPropagation();
                            onRemovePin(nodeId, pin.id);
                        }}
                    >
                        <Minus className="h-3 w-3" aria-hidden />
                    </Button>
                ) : null}
                {dynamicLabelParamKey ? (
                    <DynamicPinLabelInput
                        pin={pin}
                        nodeId={nodeId}
                        labelParamKey={dynamicLabelParamKey}
                        labels={dynamicLabelValues ?? {}}
                        onPatchNodeParam={onPatchNodeParam}
                    />
                ) : (
                    <span className="min-w-0 shrink truncate text-2xs leading-tight text-fg-muted">
                        {pinLabelOnly(pin, t)}
                    </span>
                )}
                {dynamicTypeParamKey && dynamicTypeOptions?.length ? (
                    <DynamicPinTypeSelect
                        pin={pin}
                        nodeId={nodeId}
                        typeParamKey={dynamicTypeParamKey}
                        types={dynamicTypeValues ?? {}}
                        typeOptions={dynamicTypeOptions}
                        onPatchNodeParam={onPatchNodeParam}
                    />
                ) : null}
                <div className="w-2.5 shrink-0" aria-hidden />
                <Handle
                    type="source"
                    position={Position.Right}
                    id={pin.id}
                    className={`${handleClass} !right-0 !top-1/2 !-translate-y-1/2`}
                    title={pinCaption(pin, semantic, t)}
                />
            </div>
        );
    }
    return (
        <div className="relative flex min-h-[20px] w-full min-w-0 items-center justify-end pl-0.5 pr-1">
            <span
                className="min-w-0 flex-1 truncate pr-3.5 text-right text-2xs leading-tight text-fg-muted"
                title={pinCaption(pin, semantic, t)}
            >
                {pinCaption(pin, semantic, t)}
            </span>
            <Handle
                type="source"
                position={Position.Right}
                id={pin.id}
                className={`${handleClass} !right-0 !top-1/2 !-translate-y-1/2`}
                title={pinCaption(pin, semantic, t)}
            />
        </div>
    );
}

function variableValueTypeToLiteralMode(valueType: unknown): LiteralEditMode {
    if (valueType === "integer" || valueType === "float") {
        return "number";
    }
    if (valueType === "boolean") {
        return "boolean";
    }
    if (valueType === "json" || valueType === "array" || valueType === "any" || valueType === BLUEPRINT_VALUE_TYPE_TIMER) {
        return "json";
    }
    return "string";
}

const KEYBOARD_MODIFIER_EVENT_KEYS = new Set(["alt", "control", "shift", "meta"]);

function isKeyboardModifierEvent(event: KeyboardEvent): boolean {
    return KEYBOARD_MODIFIER_EVENT_KEYS.has(normalizeBlueprintKeyboardEventKeyName(event.key));
}

function KeyboardBindingCardControl({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (value: string | undefined) => void;
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [listening, setListening] = useState(false);
    const [preview, setPreview] = useState("");
    const pendingModifierBindingRef = useRef("");
    const displayValue = formatBlueprintKeyboardBinding(value);

    const stopKeyboardCapture = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    };

    const commitBinding = useCallback(
        (binding: string) => {
            const normalized = formatBlueprintKeyboardBinding(binding);
            if (!normalized) {
                return;
            }
            onChange(normalized);
            pendingModifierBindingRef.current = "";
            setPreview("");
            setListening(false);
        },
        [onChange],
    );

    useEffect(() => {
        if (!listening) {
            pendingModifierBindingRef.current = "";
            setPreview("");
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            stopKeyboardCapture(event);
            const binding = formatBlueprintKeyboardBindingFromEvent(event);
            if (!binding) {
                return;
            }
            setPreview(binding);
            if (isKeyboardModifierEvent(event)) {
                pendingModifierBindingRef.current = binding;
                return;
            }
            commitBinding(binding);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            stopKeyboardCapture(event);
            if (!isKeyboardModifierEvent(event)) {
                return;
            }
            const pending = pendingModifierBindingRef.current;
            if (pending) {
                commitBinding(pending);
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && rootRef.current?.contains(target)) {
                return;
            }
            pendingModifierBindingRef.current = "";
            setListening(false);
        };
        const onBlur = () => {
            pendingModifierBindingRef.current = "";
            setListening(false);
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("blur", onBlur);
        };
    }, [commitBinding, listening]);

    return (
        <div ref={rootRef} className="nodrag relative min-w-0">
            {listening ? (
                <div className="absolute bottom-full left-0 z-[60] mb-1 w-full rounded border border-primary/35 bg-surface-overlay px-2 py-1.5 text-left shadow-lg ring-1 ring-black/35">
                    <div className="truncate font-mono text-2xs text-primary">
                        {preview || t("blueprint.keyboard.pressKey")}
                    </div>
                    <div className="mt-0.5 truncate text-2xs text-fg-muted">{t("blueprint.keyboard.anyCombo")}</div>
                </div>
            ) : null}
            <button
                type="button"
                className={`flex min-h-[26px] w-full min-w-0 items-center gap-1.5 rounded border px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                    listening
                        ? "border-primary/45 bg-primary/10 text-primary"
                        : "border-edge bg-surface text-fg hover:border-primary/35 hover:bg-fill-subtle"
                } ${displayValue ? "pr-7" : ""}`}
                title={displayValue ? t("blueprint.keyboard.boundTo", { key: displayValue }) : t("blueprint.keyboard.bind")}
                aria-label={displayValue ? t("blueprint.keyboard.boundTo", { key: displayValue }) : t("blueprint.keyboard.bind")}
                aria-pressed={listening}
                onMouseDown={stopFlowNodePointerBubble}
                onPointerDown={stopFlowNodePointerBubble}
                onClick={event => {
                    event.stopPropagation();
                    pendingModifierBindingRef.current = "";
                    setPreview("");
                    setListening(open => !open);
                }}
            >
                <KeyboardIcon className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
                <span className={`min-w-0 flex-1 truncate font-mono text-2xs ${displayValue ? "" : "text-fg-subtle"}`}>
                    {displayValue || t("blueprint.keyboard.unbound")}
                </span>
            </button>
            {displayValue ? (
                <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:bg-fill hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                    title={t("blueprint.keyboard.clear")}
                    aria-label={t("blueprint.keyboard.clear")}
                    onMouseDown={event => {
                        event.stopPropagation();
                        event.preventDefault();
                    }}
                    onPointerDown={event => {
                        event.stopPropagation();
                    }}
                    onClick={event => {
                        event.stopPropagation();
                        pendingModifierBindingRef.current = "";
                        setListening(false);
                        onChange(undefined);
                    }}
                >
                    <X className="h-3 w-3" aria-hidden />
                </button>
            ) : null}
        </div>
    );
}

function InspectorParamOnCard({
    spec,
    nodeType,
    nodeId,
    params,
    onPatchNodeParam,
    memberVariables,
    persistentVariables,
    dynamicSelectOptions,
}: {
    spec: BlueprintInspectorParamDef;
    nodeType: string;
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
    memberVariables?: BlueprintFlowNodeData["memberVariables"];
    persistentVariables?: BlueprintFlowNodeData["persistentVariables"];
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
}) {
    const { t } = useTranslation();
    const raw = spec.key in params ? params[spec.key] : undefined;
    const variableSelectValue =
        spec.kind === "variableRef"
            ? typeof raw === "string" && memberVariables?.some(v => v.value === raw)
                ? raw
                : ""
            : undefined;
    const persistentVariableSelectValue =
        spec.kind === "persistentVariableRef"
            ? typeof raw === "string" && persistentVariables?.some(v => v.value === raw)
                ? raw
                : ""
            : undefined;

    const rawSelectOptions: BlueprintInspectorParamSelectOption[] | undefined =
        spec.kind === "select"
            ? spec.options ?? (spec.dynamicOptionsSource ? dynamicSelectOptions?.[spec.dynamicOptionsSource] : undefined)
            : undefined;
    const selectOptions =
        rawSelectOptions && spec.dynamicOptionsFilter
            ? rawSelectOptions.filter(option => (
                  option.meta?.[spec.dynamicOptionsFilter!.optionMetaKey] === String(params[spec.dynamicOptionsFilter!.paramKey] ?? "")
              ))
            : rawSelectOptions;
    const selectComponentOptions: SelectOption[] | undefined = selectOptions
        ? [
              { value: "", label: resolveBlueprintLabel(spec.emptyOptionLabel ?? "-", t) },
              ...selectOptions.map(opt => ({ value: opt.value, label: resolveBlueprintLabel(opt.label, t) })),
          ]
        : undefined;
    const variableComponentOptions: SelectOption[] = [
        { value: "", label: "-" },
        ...(memberVariables ?? []).map(v => ({
            value: v.value,
            label: v.name,
            secondaryLabel: v.disambiguationLabel,
        })),
    ];
    const persistentVariableComponentOptions: SelectOption[] = [
        { value: "", label: "-" },
        ...(persistentVariables ?? []).map(v => ({
            value: v.value,
            label: v.name,
        })),
    ];
    const isVarDefaultValueParam =
        spec.kind === "literal" && spec.key === "defaultValue" && nodeType === BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR;
    const isReadonlyAnyDefaultValue = isVarDefaultValueParam && params.valueType === "any";
    const fixedLiteralMode =
        isVarDefaultValueParam && !isReadonlyAnyDefaultValue
            ? variableValueTypeToLiteralMode(params.valueType)
            : undefined;

    return (
        <div
            key={spec.key}
            className="mt-1.5 border-t border-edge-subtle pt-1.5"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <div className="mb-0.5 text-2xs tracking-wide text-fg-subtle">{resolveBlueprintLabel(spec.label, t)}</div>
            {spec.kind === "select" && selectComponentOptions ? (
                <Select
                    fullWidth
                    size="sm"
                    options={selectComponentOptions}
                    value={typeof raw === "string" ? raw : ""}
                    onChange={value => {
                        const v = String(value);
                        onPatchNodeParam(nodeId, spec.key, v.length > 0 ? v : undefined);
                    }}
                    portalMenu
                    menuPlacement="below"
                />
            ) : spec.kind === "variableRef" ? (
                <Select
                    fullWidth
                    size="sm"
                    options={variableComponentOptions}
                    value={variableSelectValue}
                    onChange={value => {
                        const v = String(value);
                        onPatchNodeParam(nodeId, spec.key, v.length > 0 ? v : undefined);
                    }}
                    portalMenu
                    menuPlacement="below"
                />
            ) : spec.kind === "persistentVariableRef" ? (
                <Select
                    fullWidth
                    size="sm"
                    options={persistentVariableComponentOptions}
                    value={persistentVariableSelectValue}
                    onChange={value => {
                        const v = String(value);
                        onPatchNodeParam(nodeId, spec.key, v.length > 0 ? v : undefined);
                    }}
                    portalMenu
                    menuPlacement="below"
                />
            ) : isReadonlyAnyDefaultValue ? (
                <Input
                    className={`${CARD_INPUT} cursor-not-allowed text-fg-subtle`}
                    type="text"
                    value="null"
                    size="sm"
                    fullWidth
                    disabled
                    readOnly
                />
            ) : spec.kind === "literal" ? (
                <BlueprintLiteralValueControl
                    variant="nodeCard"
                    value={fixedLiteralMode ? raw : raw ?? ""}
                    fixedMode={fixedLiteralMode}
                    onChange={v => onPatchNodeParam(nodeId, spec.key, v)}
                />
            ) : spec.kind === "json" ? (
                <BlueprintJsonValueControl
                    value={raw}
                    schema={spec.jsonSchema}
                    onChange={v => onPatchNodeParam(nodeId, spec.key, v)}
                />
            ) : spec.kind === "color" ? (
                <BlueprintColorValueControl value={raw} onChange={v => onPatchNodeParam(nodeId, spec.key, v)} />
            ) : spec.kind === "imageAsset" ? (
                <ImageAssetPickerCard value={raw} onChange={v => onPatchNodeParam(nodeId, spec.key, v)} />
            ) : spec.kind === "keyboardBinding" ? (
                <KeyboardBindingCardControl value={raw} onChange={v => onPatchNodeParam(nodeId, spec.key, v)} />
            ) : spec.kind === "buttonCursor" ? (
                <ButtonCursorSelect
                    value={raw}
                    size="sm"
                    portalMenu
                    menuPlacement="below"
                    onChange={v => onPatchNodeParam(nodeId, spec.key, v)}
                />
            ) : (
                <Input
                    className={
                        spec.kind === "number"
                            ? `${CARD_INPUT} ${INPUT_NUMBER_NO_SPINNER}`
                            : CARD_INPUT
                    }
                    type={spec.kind === "number" ? "number" : "text"}
                    value={spec.kind === "number" ? String(raw ?? "") : String(raw ?? "")}
                    size="sm"
                    fullWidth
                    onChange={e => {
                        const v =
                            spec.kind === "number" ? Number(e.target.value) : e.target.value;
                        onPatchNodeParam(nodeId, spec.key, v);
                    }}
                />
            )}
        </div>
    );
}

function buildDisplayableAnimatePropertyOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "opacity", label: t("blueprint.displayable.property.opacity") },
        { value: "offsetX", label: t("blueprint.displayable.property.offsetX") },
        { value: "offsetY", label: t("blueprint.displayable.property.offsetY") },
        { value: "x", label: t("blueprint.displayable.property.x") },
        { value: "y", label: t("blueprint.displayable.property.y") },
        { value: "scale", label: t("blueprint.displayable.property.scale") },
        { value: "rotation", label: t("blueprint.displayable.property.rotation") },
    ];
}

function buildDisplayableAnimateEasingOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "linear", label: t("blueprint.displayable.easing.linear") },
        { value: "easeIn", label: t("blueprint.displayable.easing.easeIn") },
        { value: "easeOut", label: t("blueprint.displayable.easing.easeOut") },
        { value: "easeInOut", label: t("blueprint.displayable.easing.easeInOut") },
        { value: "circIn", label: t("blueprint.displayable.easing.circIn") },
        { value: "circOut", label: t("blueprint.displayable.easing.circOut") },
        { value: "circInOut", label: t("blueprint.displayable.easing.circInOut") },
    ];
}

function buildDisplayableAnimateAfterOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "hold", label: t("blueprint.displayable.after.hold") },
        { value: "reset", label: t("common.reset") },
    ];
}

function buildDisplayableGetPropertyOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "position", label: t("blueprint.displayable.property.position") },
        { value: "size", label: t("blueprint.displayable.property.size") },
        { value: "bounds", label: t("blueprint.displayable.property.bounds") },
        { value: "x", label: t("blueprint.displayable.property.x") },
        { value: "y", label: t("blueprint.displayable.property.y") },
        { value: "offsetX", label: t("blueprint.displayable.property.offsetX") },
        { value: "offsetY", label: t("blueprint.displayable.property.offsetY") },
        { value: "width", label: t("blueprint.displayable.property.width") },
        { value: "height", label: t("blueprint.displayable.property.height") },
        { value: "rotation", label: t("blueprint.displayable.property.rotation") },
        { value: "opacity", label: t("blueprint.displayable.property.opacity") },
        { value: "visible", label: t("blueprint.displayable.property.visible") },
    ];
}

function buildDisplayableSetPropertyOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "x", label: t("blueprint.displayable.property.x") },
        { value: "y", label: t("blueprint.displayable.property.y") },
        { value: "offsetX", label: t("blueprint.displayable.property.offsetX") },
        { value: "offsetY", label: t("blueprint.displayable.property.offsetY") },
        { value: "width", label: t("blueprint.displayable.property.width") },
        { value: "height", label: t("blueprint.displayable.property.height") },
        { value: "rotation", label: t("blueprint.displayable.property.rotation") },
        { value: "opacity", label: t("blueprint.displayable.property.opacity") },
        { value: "visible", label: t("blueprint.displayable.property.visible") },
    ];
}

function buildDisplayableVisibleOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "true", label: t("blueprint.displayable.visibleState.visible") },
        { value: "false", label: t("blueprint.displayable.visibleState.hidden") },
    ];
}

function buildDisplayableSetVariantWaitOptions(t: UseTranslation["t"]): SelectOption[] {
    return [
        { value: "continue", label: t("common.no") },
        { value: "wait", label: t("common.yes") },
    ];
}

function numericParam(params: Record<string, unknown>, key: string, fallback: number): string {
    const value = params[key];
    return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

function optionalNumericParam(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function formatCompactNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function opacityPercentParam(params: Record<string, unknown>, key: string, fallbackPercent: number): string {
    const value = params[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return String(fallbackPercent);
    }
    return formatCompactNumber(value > 1 ? value : value * 100);
}

function CardFieldLabel({ children }: { children: ReactNode }) {
    return <div className="mb-0.5 text-2xs tracking-wide text-fg-subtle">{children}</div>;
}

function CardNumberInput({
    value,
    unit,
    ariaLabel,
    disabled = false,
    onCommit,
}: {
    value: string;
    unit?: string;
    ariaLabel: string;
    disabled?: boolean;
    onCommit: (raw: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const editingRef = useRef(false);
    const draftRef = useRef(value);
    const valueRef = useRef(value);
    const onCommitRef = useRef(onCommit);

    useEffect(() => {
        valueRef.current = value;
        if (!editingRef.current) {
            draftRef.current = value;
            setDraft(value);
        }
    }, [value]);

    useEffect(() => {
        onCommitRef.current = onCommit;
    }, [onCommit]);

    const commitDraft = useCallback(() => {
        if (disabled) {
            editingRef.current = false;
            draftRef.current = valueRef.current;
            setDraft(valueRef.current);
            return;
        }
        const next = draftRef.current;
        editingRef.current = false;
        if (next !== valueRef.current) {
            valueRef.current = next;
            onCommitRef.current(next);
            return;
        }
        setDraft(valueRef.current);
    }, [disabled]);

    useEffect(() => {
        const commitIfEditing = () => {
            if (editingRef.current) {
                commitDraft();
            }
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                commitIfEditing();
            }
        };
        window.addEventListener("blur", commitIfEditing);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.removeEventListener("blur", commitIfEditing);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            commitIfEditing();
        };
    }, [commitDraft]);

    return (
        <div className="relative">
            <input
                className={`nodrag block w-full rounded border border-edge bg-surface px-1.5 py-1 font-mono text-2xs text-fg transition-colors focus:border-primary focus:outline-none ${
                    unit ? "pr-8" : ""
                } ${disabled ? "cursor-not-allowed opacity-55" : ""} ${INPUT_NUMBER_NO_SPINNER}`}
                type="text"
                inputMode="decimal"
                value={draft}
                aria-label={ariaLabel}
                disabled={disabled}
                onFocus={() => {
                    editingRef.current = true;
                }}
                onChange={e => {
                    draftRef.current = e.target.value;
                    setDraft(e.target.value);
                }}
                onBlur={commitDraft}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                        editingRef.current = false;
                        draftRef.current = valueRef.current;
                        setDraft(valueRef.current);
                        e.currentTarget.blur();
                    }
                }}
            />
            {unit ? (
                <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center font-mono text-2xs text-fg-subtle">
                    {unit}
                </span>
            ) : null}
        </div>
    );
}

function displayableSetPropertyDefaultValue(property: string): number | boolean {
    switch (property) {
        case "width":
        case "height":
            return 100;
        case "opacity":
            return 100;
        case "visible":
            return true;
        case "x":
        case "y":
        case "offsetX":
        case "offsetY":
        case "rotation":
        default:
            return 0;
    }
}

function displayableSetPropertyUnit(property: string): string | undefined {
    switch (property) {
        case "x":
        case "y":
        case "offsetX":
        case "offsetY":
        case "width":
        case "height":
            return "px";
        case "rotation":
            return "deg";
        case "opacity":
            return "%";
        default:
            return undefined;
    }
}

function displayableAnimatePropertyUnit(property: string): string | undefined {
    switch (property) {
        case "opacity":
            return "%";
        case "offsetX":
        case "offsetY":
        case "x":
        case "y":
            return "px";
        case "scale":
            return "x";
        case "rotation":
            return "deg";
        default:
            return undefined;
    }
}

function booleanParam(params: Record<string, unknown>, key: string, fallback: boolean): string {
    const value = params[key];
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "string" && (value === "true" || value === "false")) {
        return value;
    }
    return fallback ? "true" : "false";
}

function DisplayableGetPropertyCard({
    nodeId,
    params,
    onPatchNodeParam,
}: {
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: BlueprintNodeParamPatch;
}) {
    const { t } = useTranslation();
    const propertyOptions = useMemo(() => buildDisplayableGetPropertyOptions(t), [t]);
    const property = typeof params.property === "string" ? params.property : "position";
    return (
        <div
            className="mt-1.5 border-t border-edge-subtle pt-1.5"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <CardFieldLabel>{t("blueprint.displayable.propertyLabel")}</CardFieldLabel>
            <Select
                fullWidth
                size="sm"
                options={propertyOptions}
                value={property}
                onChange={value => onPatchNodeParam(nodeId, "property", String(value) || "position")}
                portalMenu
                menuPlacement="below"
            />
        </div>
    );
}

function DisplayableSetPropertyCard({
    nodeId,
    params,
    valueWired,
    onPatchNodeParam,
}: {
    nodeId: string;
    params: Record<string, unknown>;
    valueWired: boolean;
    onPatchNodeParam: BlueprintNodeParamPatch;
}) {
    const { t } = useTranslation();
    const propertyOptions = useMemo(() => buildDisplayableSetPropertyOptions(t), [t]);
    const visibleOptions = useMemo(() => buildDisplayableVisibleOptions(t), [t]);
    const property = typeof params.property === "string" ? params.property : "opacity";
    const isVisible = property === "visible";
    const isOpacity = property === "opacity";
    const valueUnit = displayableSetPropertyUnit(property);
    const patchNumber = (raw: string) => {
        const value = Number(raw);
        onPatchNodeParam(
            nodeId,
            "value",
            Number.isFinite(value) ? value : displayableSetPropertyDefaultValue(property),
            {
                mergeKey: `set-displayable-property:${nodeId}:value`,
                mergeWindowMs: 600,
            },
        );
    };
    const onChangeProperty = (raw: string | number) => {
        const nextProperty = String(raw) || "opacity";
        onPatchNodeParam(nodeId, "property", nextProperty);
        if (valueWired) {
            return;
        }
        const defaultValue = displayableSetPropertyDefaultValue(nextProperty);
        const currentValue = params.value;
        const shouldReset =
            nextProperty === "visible"
                ? typeof currentValue !== "boolean" && currentValue !== "true" && currentValue !== "false"
                : typeof currentValue !== "number" || !Number.isFinite(currentValue);
        if (shouldReset) {
            onPatchNodeParam(nodeId, "value", defaultValue);
        }
    };

    return (
        <div
            className="mt-1.5 border-t border-edge-subtle pt-1.5"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <CardFieldLabel>{t("blueprint.displayable.propertyLabel")}</CardFieldLabel>
            <Select
                fullWidth
                size="sm"
                options={propertyOptions}
                value={property}
                onChange={onChangeProperty}
                portalMenu
                menuPlacement="below"
            />
            <div className="mt-1.5">
                <CardFieldLabel>{t("blueprint.displayable.valueLabel")}</CardFieldLabel>
                {isVisible ? (
                    <Select
                        fullWidth
                        size="sm"
                        options={visibleOptions}
                        value={booleanParam(params, "value", true)}
                        disabled={valueWired}
                        onChange={value => onPatchNodeParam(nodeId, "value", value === "true")}
                        portalMenu
                        menuPlacement="below"
                    />
                ) : (
                    <CardNumberInput
                        value={
                            isOpacity
                                ? opacityPercentParam(
                                      params,
                                      "value",
                                      displayableSetPropertyDefaultValue(property) as number,
                                  )
                                : numericParam(
                                      params,
                                      "value",
                                      displayableSetPropertyDefaultValue(property) as number,
                                  )
                        }
                        unit={valueUnit}
                        ariaLabel={t("blueprint.displayable.valueAria")}
                        disabled={valueWired}
                        onCommit={patchNumber}
                    />
                )}
            </div>
        </div>
    );
}

function DisplayableSetVariantCard({
    nodeId,
    params,
    onPatchNodeParam,
    elementTarget,
    targetVariants,
}: {
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: BlueprintNodeParamPatch;
    elementTarget: boolean;
    targetVariants?: BlueprintFlowNodeData["displayableTargetVariants"];
}) {
    const { t } = useTranslation();
    const waitOptions = useMemo(() => buildDisplayableSetVariantWaitOptions(t), [t]);
    const variantId = typeof params.variantId === "string" ? params.variantId : "";
    const waitForTransition = params.waitForTransition === "wait" || params.waitForTransition === true
        ? "wait"
        : "continue";
    const options = (targetVariants?.options ?? []).map(option => ({
        value: option.value,
        label: option.label,
    }));
    const selectedValue = options.some(option => option.value === variantId) ? variantId : "";
    const message = (
        targetVariants?.message ??
        (targetVariants
            ? targetVariants.supported
                ? options.length > 0
                    ? targetVariants.targetLabel
                    : t("blueprint.displayable.variant.noVariants")
                : t("blueprint.displayable.variant.unsupported")
            : elementTarget
              ? t("blueprint.displayable.variant.connectElement")
              : t("blueprint.displayable.variant.widgetUnavailable"))
    ) || t("blueprint.displayable.variant.unavailable");
    const disabled = !targetVariants?.supported || options.length === 0;
    const selectOptions: SelectOption[] = disabled
        ? [{ value: "", label: message, disabled: true }]
        : options;

    return (
        <div
            className="mt-1.5 border-t border-edge-subtle pt-1.5"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <CardFieldLabel>{t("blueprint.displayable.variantLabel")}</CardFieldLabel>
            <Select
                fullWidth
                size="sm"
                options={selectOptions}
                value={disabled ? "" : selectedValue}
                placeholder={t("blueprint.displayable.selectVariant")}
                disabled={disabled}
                onChange={value => onPatchNodeParam(nodeId, "variantId", String(value))}
                portalMenu
                menuPlacement="below"
            />
            <div className="mt-1.5">
                <CardFieldLabel>{t("blueprint.displayable.waitForAnimation")}</CardFieldLabel>
                <Select
                    fullWidth
                    size="sm"
                    options={waitOptions}
                    value={waitForTransition}
                    onChange={value => onPatchNodeParam(nodeId, "waitForTransition", String(value) || "continue")}
                    portalMenu
                    menuPlacement="below"
                />
            </div>
            {message ? (
                <div
                    className={`mt-1 truncate text-2xs ${
                        targetVariants?.supported === false ? "text-warning" : "text-fg-subtle"
                    }`}
                    title={message}
                >
                    {message}
                </div>
            ) : null}
        </div>
    );
}

function DisplayableAnimatePropertyCard({
    nodeId,
    params,
    onPatchNodeParam,
}: {
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: BlueprintNodeParamPatch;
}) {
    const { t } = useTranslation();
    const propertyOptions = useMemo(() => buildDisplayableAnimatePropertyOptions(t), [t]);
    const easingOptions = useMemo(() => buildDisplayableAnimateEasingOptions(t), [t]);
    const afterOptions = useMemo(() => buildDisplayableAnimateAfterOptions(t), [t]);
    const property = typeof params.property === "string" ? params.property : "opacity";
    const easing = typeof params.easing === "string" ? params.easing : "easeOut";
    const after = typeof params.after === "string" ? params.after : "hold";
    const valueUnit = displayableAnimatePropertyUnit(property);
    const toFallback = property === "opacity" ? 100 : property === "scale" ? 1 : 0;
    const isLegacyAbsolutePositionFromDefault =
        (property === "x" || property === "y") &&
        params[BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT] !== true &&
        Number(params.from) === 0;
    const patchNumber = (key: string, raw: string, fallback: number) => {
        const value = Number(raw);
        onPatchNodeParam(nodeId, key, Number.isFinite(value) ? value : fallback, {
            mergeKey: `animate-property:${nodeId}:${key}`,
            mergeWindowMs: 600,
        });
    };
    const patchOptionalNumber = (key: string, raw: string) => {
        const trimmed = raw.trim();
        const value = trimmed.length > 0 ? Number(trimmed) : undefined;
        onPatchNodeParam(nodeId, key, value !== undefined && Number.isFinite(value) ? value : undefined, {
            mergeKey: `animate-property:${nodeId}:${key}`,
            mergeWindowMs: 600,
        });
    };

    return (
        <div
            className="mt-1.5 border-t border-edge-subtle pt-1.5"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <div>
                <CardFieldLabel>{t("blueprint.displayable.propertyLabel")}</CardFieldLabel>
                <Select
                    fullWidth
                    size="sm"
                    options={propertyOptions}
                    value={property}
                    onChange={value => onPatchNodeParam(nodeId, "property", String(value) || "opacity")}
                    portalMenu
                    menuPlacement="below"
                />
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <div>
                    <CardFieldLabel>{t("blueprint.displayable.from")}</CardFieldLabel>
                    <CardNumberInput
                        value={
                            isLegacyAbsolutePositionFromDefault
                                ? ""
                                : optionalNumericParam(params, "from")
                        }
                        unit={valueUnit}
                        ariaLabel={t("blueprint.displayable.animationStart")}
                        onCommit={raw => patchOptionalNumber("from", raw)}
                    />
                </div>
                <div>
                    <CardFieldLabel>{t("blueprint.displayable.to")}</CardFieldLabel>
                    <CardNumberInput
                        value={numericParam(params, "to", toFallback)}
                        unit={valueUnit}
                        ariaLabel={t("blueprint.displayable.animationTarget")}
                        onCommit={raw => patchNumber("to", raw, toFallback)}
                    />
                </div>
                <div>
                    <CardFieldLabel>{t("blueprint.displayable.duration")}</CardFieldLabel>
                    <CardNumberInput
                        value={numericParam(params, "duration", 0.3)}
                        unit="s"
                        ariaLabel={t("blueprint.displayable.animationDuration")}
                        onCommit={raw => patchNumber("duration", raw, 0.3)}
                    />
                </div>
                <div>
                    <CardFieldLabel>{t("blueprint.displayable.delay")}</CardFieldLabel>
                    <CardNumberInput
                        value={numericParam(params, "delay", 0)}
                        unit="s"
                        ariaLabel={t("blueprint.displayable.animationDelay")}
                        onCommit={raw => patchNumber("delay", raw, 0)}
                    />
                </div>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <div>
                    <CardFieldLabel>{t("blueprint.displayable.easingLabel")}</CardFieldLabel>
                    <Select
                        fullWidth
                        size="sm"
                        options={easingOptions}
                        value={easing}
                        onChange={value => onPatchNodeParam(nodeId, "easing", String(value) || "easeOut")}
                        portalMenu
                        menuPlacement="below"
                    />
                </div>
                <div>
                    <CardFieldLabel>{t("blueprint.displayable.afterLabel")}</CardFieldLabel>
                    <Select
                        fullWidth
                        size="sm"
                        options={afterOptions}
                        value={after}
                        onChange={value => onPatchNodeParam(nodeId, "after", String(value) || "hold")}
                        portalMenu
                        menuPlacement="below"
                    />
                </div>
            </div>
        </div>
    );
}

function readPositiveNumberParam(
    params: Record<string, unknown>,
    key: string,
    fallback: number,
): number {
    const n = Number(params[key] ?? fallback);
    if (!Number.isFinite(n) || n <= 0) {
        return fallback;
    }
    return n;
}

function BlueprintCommentNodeCard({
    nodeId,
    displayName,
    params,
    selected,
    onPatchNodeParam,
}: {
    nodeId: string;
    displayName: string;
    params: Record<string, unknown>;
    selected?: boolean;
    onPatchNodeParam?: BlueprintNodeParamPatch;
}) {
    const { t } = useTranslation();
    const { getZoom } = useReactFlow();
    const colorKey = typeof params.color === "string" && COMMENT_COLORS[params.color] ? params.color : "amber";
    const color = COMMENT_COLORS[colorKey] ?? COMMENT_COLORS.amber;
    const backgroundEnabled = params.background !== false;
    const width = readPositiveNumberParam(params, "width", COMMENT_DEFAULT_WIDTH);
    const height = readPositiveNumberParam(params, "height", COMMENT_DEFAULT_HEIGHT);
    const [draftSize, setDraftSize] = useState({ width, height });
    const isResizingRef = useRef(false);

    useEffect(() => {
        if (isResizingRef.current) {
            return;
        }
        setDraftSize({ width, height });
    }, [width, height]);

    const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!onPatchNodeParam) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        isResizingRef.current = true;
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = draftSize.width;
        const startHeight = draftSize.height;
        const zoom = Math.max(getZoom(), 0.01);
        const history = { mergeKey: `comment-resize:${nodeId}`, mergeWindowMs: 800 };

        const readNextSize = (ev: PointerEvent) => {
            const nextWidth = Math.max(1, Math.round(startWidth + (ev.clientX - startX) / zoom));
            const nextHeight = Math.max(1, Math.round(startHeight + (ev.clientY - startY) / zoom));
            return { width: nextWidth, height: nextHeight };
        };

        const applyDraftSize = (ev: PointerEvent) => {
            const { width: nextWidth, height: nextHeight } = readNextSize(ev);
            setDraftSize({ width: nextWidth, height: nextHeight });
        };

        const onMove = (ev: PointerEvent) => {
            applyDraftSize(ev);
        };
        const finishResize = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", finishResize);
            window.removeEventListener("pointercancel", finishResize);
            const { width: nextWidth, height: nextHeight } = readNextSize(ev);
            setDraftSize({ width: nextWidth, height: nextHeight });
            onPatchNodeParam(nodeId, "width", nextWidth, history);
            onPatchNodeParam(nodeId, "height", nextHeight, history);
            window.setTimeout(() => {
                isResizingRef.current = false;
                setDraftSize({ width: nextWidth, height: nextHeight });
            }, 0);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", finishResize);
        window.addEventListener("pointercancel", finishResize);
    };

    return (
        <div
            className="group relative flex flex-col overflow-hidden rounded border shadow-lg backdrop-blur-[1px]"
            style={{
                width: draftSize.width,
                height: draftSize.height,
                borderColor: selected ? color.selectedBorder : color.border,
                background: color.background,
                boxShadow: selected ? `0 0 0 1px ${color.selectedBorder}` : undefined,
            }}
        >
            <div
                className="relative flex shrink-0 items-center border-b px-3 py-2"
                style={{ borderColor: color.border, background: color.header }}
            >
                <div
                    className="min-w-0 flex-1 truncate text-2xs font-semibold"
                    style={{ color: color.text }}
                >
                    {displayName}
                </div>
                <div
                    className="nodrag pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                    onPointerDown={stopFlowNodePointerBubble}
                >
                    {Object.entries(COMMENT_COLORS).map(([key, item]) => (
                        <button
                            key={key}
                            type="button"
                            className={`h-4 w-4 rounded-full border ${
                                key === colorKey ? "border-white/85" : "border-edge-strong"
                            }`}
                            style={{ background: item.swatch }}
                            title={commentColorLabel(key, t)}
                            aria-label={commentColorLabel(key, t)}
                            onClick={e => {
                                e.stopPropagation();
                                onPatchNodeParam?.(nodeId, "color", key);
                            }}
                        />
                    ))}
                    <button
                        type="button"
                        className={`relative h-4 w-4 rounded-full border border-dashed ${
                            backgroundEnabled
                                ? "border-edge-strong bg-fill-strong"
                                : "border-edge bg-transparent"
                        }`}
                        title={backgroundEnabled ? t("blueprint.comment.backgroundOn") : t("blueprint.comment.backgroundOff")}
                        aria-label={backgroundEnabled ? t("blueprint.comment.sendBehind") : t("blueprint.comment.restoreLayer")}
                        aria-pressed={backgroundEnabled}
                        onClick={e => {
                            e.stopPropagation();
                            onPatchNodeParam?.(nodeId, "background", !backgroundEnabled);
                        }}
                    >
                        {!backgroundEnabled ? (
                            <span className="absolute left-1/2 top-1/2 h-[1px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] bg-red-500" />
                        ) : null}
                    </button>
                </div>
            </div>
            <TextArea
                className="nodrag min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-fg placeholder-fg-subtle focus:border-transparent"
                value={typeof params.text === "string" ? params.text : ""}
                rows={4}
                placeholder={displayName}
                onMouseDown={stopFlowNodePointerBubble}
                onPointerDown={stopFlowNodePointerBubble}
                onChange={e => onPatchNodeParam?.(nodeId, "text", e.target.value)}
            />
            <div
                className="nodrag absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm border border-edge-strong bg-fill-subtle"
                title={t("blueprint.comment.resize")}
                onPointerDown={startResize}
            >
                <div className="absolute bottom-1 right-1 h-2 w-2 border-b border-r border-edge-strong" />
            </div>
        </div>
    );
}

function BlueprintElementLiteralNodeCard({
    catalog,
    nodeId,
    params,
    selected,
    firstNodeError,
    elementPreview,
    onBindElementLiteral,
}: {
    catalog: BlueprintNodeEditorCatalogEntry;
    nodeId: string;
    params: Record<string, unknown>;
    selected?: boolean;
    firstNodeError?: BlueprintFlowNodeDiagnostic;
    elementPreview?: BlueprintFlowNodeData["elementPreview"];
    onBindElementLiteral?: (nodeId: string) => void;
}) {
    const { t } = useTranslation();
    const elementId = typeof params.elementId === "string" ? params.elementId : "";
    const elementType = typeof params.elementType === "string" ? params.elementType : "";
    const boundLabel = elementPreview?.name || (elementId ? elementId : t("blueprint.element.select"));
    const typeLabel = elementPreview?.type || elementType || t("blueprint.element.unbound");
    const outputPins = catalog.pins.filter(p => p.kind === "output");
    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-surface-raised text-xs shadow-md ${
                firstNodeError
                    ? "border-danger/85 ring-1 ring-danger/40"
                    : selected
                      ? "border-yellow-300/90 ring-1 ring-yellow-500/45 shadow-[0_0_20px_rgba(234,179,8,0.18)]"
                      : "border-edge"
            }`}
            title={firstNodeError?.message}
            aria-invalid={Boolean(firstNodeError)}
        >
            <div className="border-b border-edge px-2 py-1.5">
                <div className="text-2xs text-fg-subtle">{resolveBlueprintCategoryLabel(catalog.category, t)}</div>
                <div className="font-medium leading-tight text-fg">{resolveBlueprintNodeTitle(catalog.displayName, t)}</div>
                <div className="mt-1 min-w-0 truncate text-2xs text-fg-muted">{boundLabel}</div>
                <div className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{typeLabel}</div>
            </div>
            <div className="mx-2 my-1.5">
                <button
                    type="button"
                    className="nodrag block w-full overflow-hidden rounded border border-edge bg-fill-subtle p-1.5 text-left transition-colors hover:border-primary/35 hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                    aria-label={elementPreview ? t("blueprint.element.selectNamed", { name: boundLabel }) : t("blueprint.element.select")}
                    onMouseDown={stopFlowNodePointerBubble}
                    onPointerDown={stopFlowNodePointerBubble}
                    onClick={e => {
                        e.stopPropagation();
                        onBindElementLiteral?.(nodeId);
                    }}
                >
                    {elementPreview?.preview ? (
                        elementPreview.preview
                    ) : (
                        <div className="flex h-[72px] w-full items-center justify-center rounded-sm border border-dashed border-edge bg-surface-sunken text-2xs text-fg-muted">
                            {t("blueprint.element.select")}
                        </div>
                    )}
                </button>
            </div>
            {outputPins.length > 0 ? (
                <div className="flex justify-end px-1 py-1.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                        {outputPins.map(pin => (
                            <OutputPinRow key={`out-${pin.id}`} pin={pin} semantic={pin.semantic} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function BlueprintImageAssetLiteralNodeCard({
    catalog,
    nodeId,
    params,
    selected,
    firstNodeError,
    onPatchNodeParam,
}: {
    catalog: BlueprintNodeEditorCatalogEntry;
    nodeId: string;
    params: Record<string, unknown>;
    selected?: boolean;
    firstNodeError?: BlueprintFlowNodeDiagnostic;
    onPatchNodeParam?: BlueprintNodeParamPatch;
}) {
    const { t } = useTranslation();
    const outputPins = catalog.pins.filter(p => p.kind === "output");
    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-surface-raised text-xs shadow-md ${
                firstNodeError
                    ? "border-danger/85 ring-1 ring-danger/40"
                    : selected
                      ? "border-cyan-400/80 ring-1 ring-cyan-500/40"
                      : "border-edge"
            }`}
            title={firstNodeError?.message}
            aria-invalid={Boolean(firstNodeError)}
        >
            <div className="border-b border-edge px-2 py-1.5">
                <div className="text-2xs tracking-wide text-fg-subtle">{resolveBlueprintCategoryLabel(catalog.category, t)}</div>
                <div className="font-medium leading-tight text-fg">{resolveBlueprintNodeTitle(catalog.displayName, t)}</div>
            </div>
            <div className="mx-2 my-1.5">
                <ImageAssetPickerCard
                    value={params.asset}
                    disabled={!onPatchNodeParam}
                    onChange={value => onPatchNodeParam?.(nodeId, "asset", value)}
                />
            </div>
            {outputPins.length > 0 ? (
                <div className="flex justify-end px-1 py-1.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                        {outputPins.map(pin => (
                            <OutputPinRow key={`out-${pin.id}`} pin={pin} semantic={pin.semantic} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function BlueprintFlowNode({ data, selected }: NodeProps) {
    const { t } = useTranslation();
    const {
        catalog,
        nodeId,
        params,
        onPatchNodeParam,
        onAddDynamicInputPin,
        onRemoveDynamicInputPin,
        memberVariables,
        persistentVariables,
        wiredInputPortIds,
        dynamicSelectOptions,
        nodeDiagnostics,
        elementPreview,
        displayableTargetVariants,
        onBindElementLiteral,
    } = data as BlueprintFlowNodeData;
    const wired = wiredInputPortIds ?? new Set<string>();
    const execIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "exec");
    const execOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "exec");
    const dataIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "data");
    const dataOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "data");

    const isEventHead = catalog.role === "eventHead" || catalog.role === "fnHead";
    const isVarDeclare = catalog.type === BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR;
    const isTerminalNode = execIns.length > 0 && execOuts.length === 0;
    const firstNodeError = nodeDiagnostics?.find(d => d.severity === "error");
    const showAddPinRow =
        Boolean(catalog.supportsDynamicInputPins) && Boolean(onAddDynamicInputPin);
    // Fn head parameters are output pins: keep the add button beside them in the output column.
    const addPinInOutputColumn = showAddPinRow && Boolean(catalog.dynamicPinsGenerateOutputs);
    const showAddInInputColumn = showAddPinRow && !addPinInOutputColumn;
    const inspectorParams = catalog.inspectorParams ?? [];
    const showAnimatePropertyCard =
        Boolean(onPatchNodeParam) &&
        (catalog.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY ||
            catalog.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY);
    const showGetPropertyCard =
        Boolean(onPatchNodeParam) &&
        (catalog.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY ||
            catalog.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY);
    const showSetPropertyCard =
        Boolean(onPatchNodeParam) &&
        (catalog.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY ||
            catalog.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY);
    const showSetVariantCard =
        Boolean(onPatchNodeParam) &&
        (catalog.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT ||
            catalog.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT);
    const showCustomCardInspector =
        showAnimatePropertyCard || showGetPropertyCard || showSetPropertyCard || showSetVariantCard;
    const showCardInspector = Boolean(onPatchNodeParam) && inspectorParams.length > 0 && !showCustomCardInspector;
    const dynamicLabelValues = useMemo(
        () => readDynamicPinLabelValues(params, catalog.dynamicInputPinLabelParamKey),
        [catalog.dynamicInputPinLabelParamKey, params],
    );
    const dynamicTypeValues = useMemo(
        () => readDynamicPinLabelValues(params, catalog.dynamicInputPinTypeParamKey),
        [catalog.dynamicInputPinTypeParamKey, params],
    );

    const leftPins: Array<{ pin: CatalogPin; semantic: "exec" | "data" }> = [
        ...execIns.map(pin => ({ pin, semantic: "exec" as const })),
        ...dataIns.map(pin => ({ pin, semantic: "data" as const })),
    ];
    const rightPins: Array<{ pin: CatalogPin; semantic: "exec" | "data" }> = [
        ...execOuts.map(pin => ({ pin, semantic: "exec" as const })),
        ...dataOuts.map(pin => ({ pin, semantic: "data" as const })),
    ];
    const hasLeftColumn = leftPins.length > 0 || showAddInInputColumn;
    const hasRightColumn = rightPins.length > 0 || addPinInOutputColumn;

    /** When only one side has pins, that column must span full card width so handles align to the true edge. */
    const onlyRightPins = !hasLeftColumn && hasRightColumn;
    const onlyLeftPins = hasLeftColumn && !hasRightColumn;
    const rightPinSpacerRows =
        catalog.type === BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING
            ? 2
            : catalog.type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE
              ? 1
              : 0;

    if (catalog.role === "comment") {
        return (
            <BlueprintCommentNodeCard
                nodeId={nodeId}
                displayName={resolveBlueprintNodeTitle(catalog.displayName, t)}
                params={params}
                selected={Boolean(selected)}
                onPatchNodeParam={onPatchNodeParam}
            />
        );
    }

    if (catalog.role === "elementLiteral" || catalog.role === "elementEventHead") {
        return (
            <BlueprintElementLiteralNodeCard
                catalog={catalog}
                nodeId={nodeId}
                params={params}
                selected={Boolean(selected)}
                firstNodeError={firstNodeError}
                elementPreview={elementPreview}
                onBindElementLiteral={onBindElementLiteral}
            />
        );
    }

    if (catalog.role === "imageAssetLiteral") {
        return (
            <BlueprintImageAssetLiteralNodeCard
                catalog={catalog}
                nodeId={nodeId}
                params={params}
                selected={Boolean(selected)}
                firstNodeError={firstNodeError}
                onPatchNodeParam={onPatchNodeParam}
            />
        );
    }

    const addPinButton = (
        <Button
            type="button"
            title={catalog.dynamicInputPinAddLabel ?? t("blueprint.pin.addInput")}
            className="nodrag mt-0.5 flex w-full items-center justify-center rounded border border-dashed border-edge !py-0.5 text-fg-subtle hover:border-edge-strong hover:bg-fill-subtle hover:text-fg-muted"
            variant="ghost"
            size="sm"
            aria-label={catalog.dynamicInputPinAddLabel ?? t("blueprint.pin.addInput")}
            onMouseDown={stopFlowNodePointerBubble}
            onPointerDown={stopFlowNodePointerBubble}
            onClick={e => {
                e.stopPropagation();
                onAddDynamicInputPin?.(nodeId);
            }}
        >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </Button>
    );

    // Pair each input row with its aligned output row so both share the SAME flex row.
    // Alignment then comes from the shared row height (not from every row being a fixed
    // 20px), so expanding a pin into an inline-literal card grows that one row on both
    // sides and never drifts the outputs below it. `rightPinSpacerRows` offsets the
    // outputs so e.g. Switch String's "Case 0" output lands beside its "Case 0" value input.
    const leftRowItems: ReactNode[] = [
        ...leftPins.map(({ pin, semantic }) => (
            <InputPinRow
                key={`in-${pin.id}`}
                pin={pin}
                semantic={semantic}
                selected={Boolean(selected)}
                nodeId={nodeId}
                params={params}
                onPatchNodeParam={onPatchNodeParam}
                isWired={wired.has(pin.id)}
                removable={Boolean(pin.removable)}
                onRemovePin={onRemoveDynamicInputPin}
                dynamicLabelParamKey={catalog.dynamicInputPinLabelParamKey}
                dynamicLabelValues={dynamicLabelValues}
                dynamicTypeParamKey={catalog.dynamicInputPinTypeParamKey}
                dynamicTypeValues={dynamicTypeValues}
                dynamicTypeOptions={catalog.dynamicInputPinTypeOptions}
            />
        )),
        ...(showAddInInputColumn ? [addPinButton] : []),
    ];
    const rightRowItems: ReactNode[] = [
        ...Array.from({ length: rightPinSpacerRows }, (_, index) => (
            <div key={`right-pin-spacer-${index}`} className="min-h-[20px]" aria-hidden />
        )),
        ...rightPins.map(({ pin, semantic }) => (
            <OutputPinRow
                key={`out-${pin.id}`}
                pin={pin}
                semantic={semantic}
                nodeId={nodeId}
                onPatchNodeParam={onPatchNodeParam}
                removable={Boolean(pin.removable)}
                onRemovePin={onRemoveDynamicInputPin}
                dynamicLabelParamKey={catalog.dynamicInputPinLabelParamKey}
                dynamicLabelValues={dynamicLabelValues}
                dynamicTypeParamKey={catalog.dynamicInputPinTypeParamKey}
                dynamicTypeValues={dynamicTypeValues}
                dynamicTypeOptions={catalog.dynamicInputPinTypeOptions}
            />
        )),
        ...(addPinInOutputColumn ? [addPinButton] : []),
    ];
    const pinRowCount = Math.max(leftRowItems.length, rightRowItems.length);

    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-surface-raised text-xs shadow-md ${
                isEventHead || isVarDeclare ? "border-l-2" : ""
            } ${isTerminalNode ? "border-r-2" : ""} ${
                firstNodeError
                    ? "border-danger/85 ring-1 ring-danger/40"
                    : selected
                      ? "border-cyan-400/80 ring-1 ring-cyan-500/40"
                      : "border-edge"
            } ${!firstNodeError && isEventHead ? "border-l-cyan-400/70" : ""} ${
                !firstNodeError && isVarDeclare ? "border-l-amber-500/80" : ""
            } ${
                !firstNodeError && isTerminalNode ? "border-r-cyan-400/70" : ""
            }`}
            title={firstNodeError?.message}
            aria-invalid={Boolean(firstNodeError)}
        >
            <div className="border-b border-edge-subtle px-2 py-1.5">
                <div className="text-2xs tracking-wide text-fg-subtle">{resolveBlueprintCategoryLabel(catalog.category, t)}</div>
                <div className="font-medium leading-tight text-fg">{resolveBlueprintNodeTitle(catalog.displayName, t)}</div>
                {showAnimatePropertyCard && onPatchNodeParam ? (
                    <DisplayableAnimatePropertyCard
                        nodeId={nodeId}
                        params={params}
                        onPatchNodeParam={onPatchNodeParam}
                    />
                ) : null}
                {showGetPropertyCard && onPatchNodeParam ? (
                    <DisplayableGetPropertyCard
                        nodeId={nodeId}
                        params={params}
                        onPatchNodeParam={onPatchNodeParam}
                    />
                ) : null}
                {showSetPropertyCard && onPatchNodeParam ? (
                    <DisplayableSetPropertyCard
                        nodeId={nodeId}
                        params={params}
                        valueWired={wired.has("value")}
                        onPatchNodeParam={onPatchNodeParam}
                    />
                ) : null}
                {showSetVariantCard && onPatchNodeParam ? (
                    <DisplayableSetVariantCard
                        nodeId={nodeId}
                        params={params}
                        onPatchNodeParam={onPatchNodeParam}
                        elementTarget={catalog.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT}
                        targetVariants={displayableTargetVariants}
                    />
                ) : null}
                {showCardInspector && onPatchNodeParam
                    ? inspectorParams.map(spec => (
                          <InspectorParamOnCard
                              key={spec.key}
                              spec={spec}
                              nodeType={catalog.type}
                              nodeId={nodeId}
                              params={params}
                              onPatchNodeParam={onPatchNodeParam}
                              memberVariables={memberVariables}
                              persistentVariables={persistentVariables}
                              dynamicSelectOptions={dynamicSelectOptions}
                          />
                      ))
                    : null}
            </div>
            {hasLeftColumn || hasRightColumn ? (
                <div className="flex flex-col gap-0.5 px-1 py-1.5">
                    {Array.from({ length: pinRowCount }).map((_, rowIndex) => (
                        // items-stretch makes both cells take the row height; each cell centers
                        // its pin row, so the left/right handles share a vertical center and stay
                        // aligned even when one side is a taller inline-literal card.
                        <div key={`pin-row-${rowIndex}`} className="flex items-stretch gap-1">
                            {hasLeftColumn ? (
                                <div
                                    className={`flex min-w-0 flex-col justify-center ${onlyLeftPins ? "w-full flex-1" : "flex-1"}`}
                                >
                                    {leftRowItems[rowIndex] ?? null}
                                </div>
                            ) : (
                                <div className="w-0 shrink-0" aria-hidden />
                            )}
                            {hasRightColumn ? (
                                <div
                                    className={`flex min-w-0 flex-col justify-center ${onlyRightPins ? "w-full min-w-0 flex-1" : "shrink-0"}`}
                                >
                                    {rightRowItems[rowIndex] ?? null}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
