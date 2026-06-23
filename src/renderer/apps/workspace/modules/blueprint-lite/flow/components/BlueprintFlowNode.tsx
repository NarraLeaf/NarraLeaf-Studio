import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { Image as ImageIcon, Link2, Minus, Plus, X } from "lucide-react";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintInspectorParamDef,
    type BlueprintInspectorParamSelectOption,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { BlueprintLiteralValueControl } from "../../components/BlueprintLiteralValueControl";
import { BlueprintJsonValueControl } from "../../components/BlueprintJsonValueControl";
import { BlueprintColorValueControl } from "../../components/BlueprintColorValueControl";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { Button, Input, TextArea } from "@/lib/components/elements";
import { BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE } from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
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
        name: string;
        type: string;
        text?: string;
        layout?: { width: number; height: number };
        preview?: ReactNode;
    };
    /** Starts the temporary same-Surface element binding flow for Element Literal nodes. */
    onBindElementLiteral?: (nodeId: string) => void;
};

const EXEC_HANDLE_CLASS = "!h-2 !w-2 !border border-white/30 !bg-cyan-500";
const DATA_HANDLE_CLASS = "!h-2 !w-2 !border border-amber-200/35 !bg-amber-500";

const CARD_INPUT =
    "rounded border-white/15 bg-[#111418] px-1.5 py-1 font-mono text-[10px]";
const CARD_ICON_BUTTON =
    "nodrag !h-4 !w-4 shrink-0 !gap-0 rounded !p-0.5 text-gray-400 hover:bg-white/5 hover:text-gray-300";

/** Hide native number steppers — keep same look as other card fields (WebKit + Firefox). */
const INPUT_NUMBER_NO_SPINNER =
    "[-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0";

/** Pin body: fixed min width, cap max — avoid equal flex-1 columns hollowing the middle on inline inputs. */
const BLUEPRINT_CARD_PIN_BODY_CLASS = "min-w-[200px] max-w-[280px]";
const COMMENT_DEFAULT_WIDTH = 360;
const COMMENT_DEFAULT_HEIGHT = 180;

function shortAssetId(assetId: string): string {
    return assetId.length > 10 ? `${assetId.slice(0, 8)}...` : assetId;
}

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
    const normalized = normalizeBlueprintImageAssetValue(value);
    const assetId = normalized?.assetId ?? null;
    const assetName = useImageAssetDisplayName(assetId);
    const { url, loading, error } = useAssetObjectUrl(assetId);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const label = assetId ? assetName ?? shortAssetId(assetId) : "Select image";
    const detail = assetId ? (error ? "Missing image asset" : "ImageAsset") : "No image asset";
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
                    className={`group relative flex w-full min-w-0 overflow-hidden rounded border border-white/10 bg-[#0f1115] text-left transition-colors ${
                        disabled ? "cursor-default opacity-80" : "hover:border-cyan-300/35 hover:bg-white/[0.04]"
                    } ${heightClass}`}
                    title={assetId ? `${label} (${assetId})` : "Select image asset"}
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
                            <div className="flex h-full w-full items-center justify-center text-gray-500">
                                <ImageIcon className="h-5 w-5" aria-hidden />
                            </div>
                        )}
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[9px] text-gray-100">
                                Loading
                            </div>
                        ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1">
                        <div className="truncate text-[11px] font-medium text-gray-100">{label}</div>
                        <div className={`truncate text-[9px] ${error ? "text-amber-300" : "text-gray-500"}`}>
                            {detail}
                        </div>
                    </div>
                    {!disabled ? (
                        <div className="pointer-events-none absolute inset-0 bg-cyan-400/0 transition-colors group-hover:bg-cyan-400/[0.04]" />
                    ) : null}
                </button>
                {assetId && !disabled ? (
                    <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-black/55 p-0.5 text-gray-300 hover:bg-black/80 hover:text-white"
                        title="Clear image asset"
                        aria-label="Clear image asset"
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
                title="Select Image Asset"
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
        label: string;
        border: string;
        selectedBorder: string;
        background: string;
        header: string;
        text: string;
        swatch: string;
    }
> = {
    amber: {
        label: "Amber",
        border: "rgba(245, 158, 11, 0.55)",
        selectedBorder: "rgba(251, 191, 36, 0.95)",
        background: "rgba(120, 78, 18, 0.28)",
        header: "rgba(245, 158, 11, 0.2)",
        text: "#fde68a",
        swatch: "#f59e0b",
    },
    cyan: {
        label: "Cyan",
        border: "rgba(34, 211, 238, 0.55)",
        selectedBorder: "rgba(103, 232, 249, 0.95)",
        background: "rgba(8, 85, 102, 0.28)",
        header: "rgba(34, 211, 238, 0.18)",
        text: "#a5f3fc",
        swatch: "#06b6d4",
    },
    violet: {
        label: "Violet",
        border: "rgba(167, 139, 250, 0.55)",
        selectedBorder: "rgba(196, 181, 253, 0.95)",
        background: "rgba(76, 29, 149, 0.26)",
        header: "rgba(167, 139, 250, 0.18)",
        text: "#ddd6fe",
        swatch: "#8b5cf6",
    },
    slate: {
        label: "Slate",
        border: "rgba(148, 163, 184, 0.5)",
        selectedBorder: "rgba(203, 213, 225, 0.92)",
        background: "rgba(51, 65, 85, 0.32)",
        header: "rgba(148, 163, 184, 0.13)",
        text: "#e2e8f0",
        swatch: "#64748b",
    },
};

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

function pinLabelOnly(pin: CatalogPin): string {
    return pin.label?.trim() || pin.id;
}

function pinCaption(pin: CatalogPin, semantic: "exec" | "data"): string {
    const name = pinLabelOnly(pin);
    if (semantic === "data" && pin.valueType && pin.valueType !== "any") {
        return `${name} · ${pin.valueType}`;
    }
    return name;
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
    const committed = labels[pin.id] ?? pinLabelOnly(pin);
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
            className={`${CARD_INPUT} min-h-[20px] min-w-[5rem] max-w-[8rem] flex-1 py-0.5 ${
                isInvalid ? "border-red-400/70 text-red-100" : ""
            }`}
            type="text"
            value={draft}
            size="sm"
            title={isInvalid ? "Field names must be non-empty and unique" : "JSON object field name"}
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
    const baseClass = className ?? CARD_INPUT;
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
}) {
    const handleClass = semantic === "exec" ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS;
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
                    className="shrink-0 text-[9px] leading-tight text-gray-400"
                    title={pinLabelOnly(pin)}
                >
                    {pinLabelOnly(pin)}
                </span>
            );
        return (
            <div className="relative flex min-h-[20px] w-full min-w-0 items-center gap-0.5 pl-1 pr-0.5">
                <div className="flex min-w-0 flex-1 items-center gap-1 pl-3.5">
                    {removable && onRemovePin ? (
                        <Button
                            type="button"
                            title="Remove input pin"
                            aria-label="Remove input pin"
                            variant="ghost"
                            size="sm"
                            className={`${CARD_ICON_BUTTON} text-gray-500`}
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
                    <PinInlineLiteralInput
                        pin={pin}
                        nodeId={nodeId}
                        params={params}
                        onPatchNodeParam={onPatchNodeParam}
                        className={`${CARD_INPUT} min-h-[20px] min-w-0 flex-1 py-0.5`}
                    />
                    <Button
                        type="button"
                        title="Show input pin"
                        aria-label="Show input pin"
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
                className="min-w-0 shrink truncate text-[9px] leading-tight text-gray-400"
                title={pinCaption(pin, semantic)}
            >
                {pinCaption(pin, semantic)}
            </span>
        );
    return (
        <div className="group relative flex min-h-[20px] w-full min-w-0 items-center pl-1 pr-0.5">
            <Handle
                type="target"
                position={Position.Left}
                id={pin.id}
                className={`${handleClass} !left-0 !top-1/2 !-translate-y-1/2`}
                title={pinCaption(pin, semantic)}
            />
            <div className="flex min-w-0 flex-1 items-center pl-3.5">
                <div className="flex min-w-0 max-w-full items-center gap-0.5">
                    {removable && onRemovePin ? (
                        <Button
                            type="button"
                            title="Remove input pin"
                            aria-label="Remove input pin"
                            variant="ghost"
                            size="sm"
                            className={`${CARD_ICON_BUTTON} text-gray-500`}
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
                    {canInlineLiteral && selected ? (
                        <Button
                            type="button"
                            title="Edit value on card"
                            aria-label="Edit value on card"
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

function OutputPinRow({ pin, semantic }: { pin: CatalogPin; semantic: "exec" | "data" }) {
    const handleClass = semantic === "exec" ? EXEC_HANDLE_CLASS : DATA_HANDLE_CLASS;
    return (
        <div className="relative flex min-h-[20px] w-full min-w-0 items-center justify-end pl-0.5 pr-1">
            <span
                className="min-w-0 flex-1 truncate pr-3.5 text-right text-[9px] leading-tight text-gray-400"
                title={pinCaption(pin, semantic)}
            >
                {pinCaption(pin, semantic)}
            </span>
            <Handle
                type="source"
                position={Position.Right}
                id={pin.id}
                className={`${handleClass} !right-0 !top-1/2 !-translate-y-1/2`}
                title={pinCaption(pin, semantic)}
            />
        </div>
    );
}

function InspectorParamOnCard({
    spec,
    nodeId,
    params,
    onPatchNodeParam,
    memberVariables,
    persistentVariables,
    dynamicSelectOptions,
}: {
    spec: BlueprintInspectorParamDef;
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
    memberVariables?: BlueprintFlowNodeData["memberVariables"];
    persistentVariables?: BlueprintFlowNodeData["persistentVariables"];
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
}) {
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

    const selectOptions: BlueprintInspectorParamSelectOption[] | undefined =
        spec.kind === "select"
            ? spec.options ?? (spec.dynamicOptionsSource ? dynamicSelectOptions?.[spec.dynamicOptionsSource] : undefined)
            : undefined;
    const selectComponentOptions: SelectOption[] | undefined = selectOptions
        ? [{ value: "", label: "-" }, ...selectOptions.map(opt => ({ value: opt.value, label: opt.label }))]
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

    return (
        <div
            key={spec.key}
            className="mt-1.5 border-t border-white/5 pt-1.5"
            onMouseDownCapture={stopFlowNodePointerBubble}
            onPointerDownCapture={stopFlowNodePointerBubble}
        >
            <div className="mb-0.5 text-[9px] uppercase tracking-wide text-gray-500">{spec.label}</div>
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
            ) : spec.kind === "literal" ? (
                <BlueprintLiteralValueControl
                    variant="nodeCard"
                    value={raw ?? ""}
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
                    className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase"
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
                                key === colorKey ? "border-white/85" : "border-white/20"
                            }`}
                            style={{ background: item.swatch }}
                            title={item.label}
                            aria-label={item.label}
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
                                ? "border-slate-300 bg-slate-400/30"
                                : "border-slate-500 bg-transparent"
                        }`}
                        title={backgroundEnabled ? "Background layer on" : "Background layer off"}
                        aria-label={backgroundEnabled ? "Send comment behind nodes" : "Restore normal comment layer"}
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
                className="nodrag min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-gray-100 placeholder-white/35 focus:border-transparent"
                value={typeof params.text === "string" ? params.text : ""}
                rows={4}
                placeholder={displayName}
                onMouseDown={stopFlowNodePointerBubble}
                onPointerDown={stopFlowNodePointerBubble}
                onChange={e => onPatchNodeParam?.(nodeId, "text", e.target.value)}
            />
            <div
                className="nodrag absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm border border-white/25 bg-black/20"
                title="Resize comment"
                onPointerDown={startResize}
            >
                <div className="absolute bottom-1 right-1 h-2 w-2 border-b border-r border-white/50" />
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
    const elementId = typeof params.elementId === "string" ? params.elementId : "";
    const elementType = typeof params.elementType === "string" ? params.elementType : "";
    const boundLabel = elementPreview?.name || (elementId ? elementId : "Select element");
    const typeLabel = elementPreview?.type || elementType || "Unbound";
    const outputPins = catalog.pins.filter(p => p.kind === "output");
    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-[#1a1d21] text-xs shadow-md ${
                firstNodeError
                    ? "border-red-400/85 ring-1 ring-red-500/40"
                    : selected
                      ? "border-yellow-300/90 ring-1 ring-yellow-500/45 shadow-[0_0_20px_rgba(234,179,8,0.18)]"
                      : "border-white/15"
            }`}
            title={firstNodeError?.message}
            aria-invalid={Boolean(firstNodeError)}
        >
            <div className="border-b border-white/10 px-2 py-1.5">
                <div className="text-[10px] uppercase text-gray-500">{catalog.category}</div>
                <div className="font-medium leading-tight text-gray-100">{catalog.displayName}</div>
                <div className="mt-1 min-w-0 truncate text-[11px] text-gray-300">{boundLabel}</div>
                <div className="min-w-0 truncate font-mono text-[10px] text-gray-500">{typeLabel}</div>
            </div>
            <div className="mx-2 my-1.5">
                <button
                    type="button"
                    className="nodrag block w-full overflow-hidden rounded border border-white/10 bg-black/20 p-1.5 text-left transition-colors hover:border-cyan-300/35 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50"
                    aria-label={elementPreview ? `Select element ${boundLabel}` : "Select element"}
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
                        <div className="flex h-[72px] w-full items-center justify-center rounded-sm border border-dashed border-white/10 bg-[#0d1117] text-[11px] text-gray-400">
                            Select element
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
    const outputPins = catalog.pins.filter(p => p.kind === "output");
    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-[#1a1d21] text-xs shadow-md ${
                firstNodeError
                    ? "border-red-400/85 ring-1 ring-red-500/40"
                    : selected
                      ? "border-cyan-400/80 ring-1 ring-cyan-500/40"
                      : "border-white/15"
            }`}
            title={firstNodeError?.message}
            aria-invalid={Boolean(firstNodeError)}
        >
            <div className="border-b border-white/10 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{catalog.category}</div>
                <div className="font-medium leading-tight text-gray-100">{catalog.displayName}</div>
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
        onBindElementLiteral,
    } = data as BlueprintFlowNodeData;
    const wired = wiredInputPortIds ?? new Set<string>();
    const execIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "exec");
    const execOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "exec");
    const dataIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "data");
    const dataOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "data");

    const isEventHead = catalog.role === "eventHead";
    const isTerminalNode = execIns.length > 0 && execOuts.length === 0;
    const firstNodeError = nodeDiagnostics?.find(d => d.severity === "error");
    const showAddInputRow =
        Boolean(catalog.supportsDynamicInputPins) && Boolean(onAddDynamicInputPin);
    const inspectorParams = catalog.inspectorParams ?? [];
    const showCardInspector = Boolean(onPatchNodeParam) && inspectorParams.length > 0;
    const dynamicLabelValues = useMemo(
        () => readDynamicPinLabelValues(params, catalog.dynamicInputPinLabelParamKey),
        [catalog.dynamicInputPinLabelParamKey, params],
    );

    const leftPins: Array<{ pin: CatalogPin; semantic: "exec" | "data" }> = [
        ...execIns.map(pin => ({ pin, semantic: "exec" as const })),
        ...dataIns.map(pin => ({ pin, semantic: "data" as const })),
    ];
    const rightPins: Array<{ pin: CatalogPin; semantic: "exec" | "data" }> = [
        ...execOuts.map(pin => ({ pin, semantic: "exec" as const })),
        ...dataOuts.map(pin => ({ pin, semantic: "data" as const })),
    ];
    const hasLeftColumn = leftPins.length > 0 || showAddInputRow;

    /** When only one side has pins, that column must span full card width so handles align to the true edge. */
    const onlyRightPins = !hasLeftColumn && rightPins.length > 0;
    const onlyLeftPins = hasLeftColumn && rightPins.length === 0;
    const offsetRightPinsForIfElse = catalog.type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE;

    if (catalog.role === "comment") {
        return (
            <BlueprintCommentNodeCard
                nodeId={nodeId}
                displayName={catalog.displayName}
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

    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-[#1a1d21] text-xs shadow-md ${
                isEventHead ? "border-l-2" : ""
            } ${isTerminalNode ? "border-r-2" : ""} ${
                firstNodeError
                    ? "border-red-400/85 ring-1 ring-red-500/40"
                    : selected
                      ? "border-cyan-400/80 ring-1 ring-cyan-500/40"
                      : "border-white/15"
            } ${!firstNodeError && isEventHead ? "border-l-cyan-400/70" : ""} ${
                !firstNodeError && isTerminalNode ? "border-r-cyan-400/70" : ""
            }`}
            title={firstNodeError?.message}
            aria-invalid={Boolean(firstNodeError)}
        >
            <div className="border-b border-white/5 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{catalog.category}</div>
                <div className="font-medium leading-tight text-gray-100">{catalog.displayName}</div>
                {showCardInspector && onPatchNodeParam
                    ? inspectorParams.map(spec => (
                          <InspectorParamOnCard
                              key={spec.key}
                              spec={spec}
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
            {hasLeftColumn || rightPins.length > 0 ? (
                <div className="flex items-start gap-1 px-1 py-1.5">
                    {hasLeftColumn ? (
                        <div
                            className={`flex min-w-0 flex-col gap-0.5 ${onlyLeftPins ? "w-full flex-1" : "flex-1"}`}
                        >
                            {leftPins.map(({ pin, semantic }) => (
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
                                />
                            ))}
                            {showAddInputRow ? (
                                <Button
                                    type="button"
                                    title={catalog.dynamicInputPinAddLabel ?? "Add input pin"}
                                    className="nodrag mt-0.5 flex w-full items-center justify-center rounded border border-dashed border-white/10 !py-0.5 text-gray-500 hover:border-white/20 hover:bg-white/[0.03] hover:text-gray-400"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={catalog.dynamicInputPinAddLabel ?? "Add input pin"}
                                    onMouseDown={stopFlowNodePointerBubble}
                                    onPointerDown={stopFlowNodePointerBubble}
                                    onClick={e => {
                                        e.stopPropagation();
                                        onAddDynamicInputPin?.(nodeId);
                                    }}
                                >
                                    <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                </Button>
                            ) : null}
                        </div>
                    ) : (
                        <div className="w-0 shrink-0" aria-hidden />
                    )}
                    {rightPins.length > 0 ? (
                        <div
                            className={`flex min-w-0 flex-col gap-0.5 ${onlyRightPins ? "w-full min-w-0 flex-1" : "shrink-0"}`}
                        >
                            {offsetRightPinsForIfElse ? <div className="min-h-[20px]" aria-hidden /> : null}
                            {rightPins.map(({ pin, semantic }) => (
                                <OutputPinRow key={`out-${pin.id}`} pin={pin} semantic={semantic} />
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
