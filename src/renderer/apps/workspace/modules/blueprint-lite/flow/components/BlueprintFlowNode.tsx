import { useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Link2, Minus, Plus } from "lucide-react";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintInspectorParamDef,
    type BlueprintInspectorParamSelectOption,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { BlueprintLiteralValueControl } from "../../components/BlueprintLiteralValueControl";
import { BlueprintJsonValueControl } from "../../components/BlueprintJsonValueControl";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { Button, Input } from "@/lib/components/elements";

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
    onPatchNodeParam?: (nodeId: string, key: string, value: unknown) => void;
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
    /** Input ports that have an incoming edge (any semantic). */
    wiredInputPortIds?: ReadonlySet<string>;
    /**
     * Dynamic select options keyed by `dynamicOptionsSource` id.
     * Populated by the flow projection from workspace context (e.g. available surfaces).
     */
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
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
    dynamicSelectOptions,
}: {
    spec: BlueprintInspectorParamDef;
    nodeId: string;
    params: Record<string, unknown>;
    onPatchNodeParam: (nodeId: string, key: string, value: unknown) => void;
    memberVariables?: BlueprintFlowNodeData["memberVariables"];
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
}) {
    const raw = spec.key in params ? params[spec.key] : undefined;
    const variableSelectValue =
        spec.kind === "variableRef"
            ? typeof raw === "string" && memberVariables?.some(v => v.value === raw)
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
            ) : spec.kind === "literal" ? (
                <BlueprintLiteralValueControl
                    variant="nodeCard"
                    value={raw ?? ""}
                    onChange={v => onPatchNodeParam(nodeId, spec.key, v)}
                />
            ) : spec.kind === "json" ? (
                <BlueprintJsonValueControl value={raw} onChange={v => onPatchNodeParam(nodeId, spec.key, v)} />
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

export function BlueprintFlowNode({ data, selected }: NodeProps) {
    const {
        catalog,
        nodeId,
        params,
        onPatchNodeParam,
        onAddDynamicInputPin,
        onRemoveDynamicInputPin,
        memberVariables,
        wiredInputPortIds,
        dynamicSelectOptions,
    } = data as BlueprintFlowNodeData;
    const wired = wiredInputPortIds ?? new Set<string>();
    const execIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "exec");
    const execOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "exec");
    const dataIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "data");
    const dataOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "data");

    const isEventHead = catalog.role === "eventHead";
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

    /** When only one side has pins, that column must span full card width so handles align to the true edge. */
    const onlyRightPins = leftPins.length === 0 && rightPins.length > 0;
    const onlyLeftPins = leftPins.length > 0 && rightPins.length === 0;

    return (
        <div
            className={`${BLUEPRINT_CARD_PIN_BODY_CLASS} rounded-md border bg-[#1a1d21] text-xs shadow-md ${
                selected ? "border-cyan-400/80 ring-1 ring-cyan-500/40" : "border-white/15"
            } ${isEventHead ? "border-l-2 border-l-cyan-400/70" : ""}`}
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
                              dynamicSelectOptions={dynamicSelectOptions}
                          />
                      ))
                    : null}
            </div>
            {leftPins.length > 0 || rightPins.length > 0 ? (
                <div className="flex items-start gap-1 px-1 py-1.5">
                    {leftPins.length > 0 ? (
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
                                    title="Add input pin"
                                    className="nodrag mt-0.5 flex w-full items-center justify-center rounded border border-dashed border-white/10 !py-0.5 text-gray-500 hover:border-white/20 hover:bg-white/[0.03] hover:text-gray-400"
                                    variant="ghost"
                                    size="sm"
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
