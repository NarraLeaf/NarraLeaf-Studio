/**
 * Type-aware literal editor for blueprint.data.literal (and shared inspector field).
 * Comments in English per project convention.
 */

import { useEffect, useState } from "react";
import { Input, TextArea } from "@/lib/components/elements/Input";
import { Select, type SelectOption } from "@/lib/components/elements/Select";

export type LiteralEditMode = "string" | "number" | "boolean" | "null" | "json";

export function inferLiteralEditMode(value: unknown): LiteralEditMode {
    if (value === undefined) {
        return "string";
    }
    if (value === null) {
        return "null";
    }
    if (typeof value === "boolean") {
        return "boolean";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return "number";
    }
    if (typeof value === "string") {
        return "string";
    }
    return "json";
}

function parseJsonDraft(jsonText: string): unknown {
    const t = jsonText.trim();
    if (!t) {
        return null;
    }
    try {
        return JSON.parse(t) as unknown;
    } catch {
        return jsonText;
    }
}

type Props = {
    value: unknown;
    onChange: (next: unknown) => void;
    /** Inspector uses full controls; node card uses a denser layout */
    variant: "inspector" | "nodeCard";
    /** Used by typed fields whose data type is controlled by a sibling selector. */
    fixedMode?: LiteralEditMode;
};

const MODE_OPTIONS: { id: LiteralEditMode; label: string }[] = [
    { id: "string", label: "String" },
    { id: "number", label: "Number" },
    { id: "boolean", label: "Bool" },
    { id: "null", label: "Null" },
    { id: "json", label: "JSON" },
];

const selectOptions = MODE_OPTIONS.map(o => ({ value: o.id, label: o.label }));
const booleanOptions: SelectOption[] = [
    { value: "true", label: "True" },
    { value: "false", label: "False" },
];

const inputInspector = "px-2 py-1 text-[11px]";
const inputNodeCard = "min-w-0 px-1.5 py-0.5 font-mono text-[10px]";

function stringifyJsonDraft(value: unknown, variant: "inspector" | "nodeCard"): string {
    try {
        const text = JSON.stringify(value ?? null, null, variant === "inspector" ? 2 : 0);
        return typeof text === "string" ? text : "null";
    } catch {
        return String(value ?? null);
    }
}

export function BlueprintLiteralValueControl({ value, onChange, variant, fixedMode }: Props) {
    const [mode, setMode] = useState<LiteralEditMode>(() => fixedMode ?? inferLiteralEditMode(value));
    const activeMode = fixedMode ?? mode;
    const [jsonDraft, setJsonDraft] = useState(() =>
        activeMode === "json" ? stringifyJsonDraft(value, variant) : "",
    );

    useEffect(() => {
        const m = fixedMode ?? inferLiteralEditMode(value);
        setMode(m);
        if (m === "json") {
            setJsonDraft(stringifyJsonDraft(value, variant));
        }
    }, [fixedMode, value, variant]);

    const applyModeChange = (nextMode: LiteralEditMode) => {
        const prev = value;
        if (nextMode === "null") {
            setMode(nextMode);
            onChange(null);
            return;
        }
        if (nextMode === "boolean") {
            setMode(nextMode);
            onChange(Boolean(prev));
            return;
        }
        if (nextMode === "number") {
            setMode(nextMode);
            const n = typeof prev === "number" ? prev : Number(prev);
            onChange(Number.isFinite(n) ? n : 0);
            return;
        }
        if (nextMode === "string") {
            setMode(nextMode);
            const seed =
                prev === null || prev === undefined
                    ? ""
                    : typeof prev === "object"
                      ? JSON.stringify(prev)
                      : String(prev);
            onChange(seed);
            return;
        }
        let draft: string;
        try {
            draft = JSON.stringify(prev, null, variant === "inspector" ? 2 : 0);
        } catch {
            draft = String(prev);
        }
        setJsonDraft(draft);
        setMode(nextMode);
        onChange(parseJsonDraft(draft));
    };

    const showModeSelector = !fixedMode;
    const showModeRow = showModeSelector || activeMode === "boolean" || activeMode === "null";

    return (
        <div
            className={variant === "inspector" ? "space-y-2" : "flex flex-col gap-1"}
            onMouseDownCapture={e => e.stopPropagation()}
            onPointerDownCapture={e => e.stopPropagation()}
        >
            {showModeRow ? (
                <div className={variant === "nodeCard" ? "flex min-w-0 items-center gap-1.5" : ""}>
                    {showModeSelector ? (
                        <Select
                            options={selectOptions}
                            value={activeMode}
                            onChange={v => applyModeChange(String(v) as LiteralEditMode)}
                            size="sm"
                            fullWidth={variant === "inspector"}
                            portalMenu
                            menuPlacement="below"
                            className={variant === "nodeCard" ? "min-w-0 flex-1" : ""}
                        />
                    ) : null}
                    {activeMode === "boolean" ? (
                        <Select
                            options={booleanOptions}
                            value={Boolean(value) ? "true" : "false"}
                            onChange={v => onChange(String(v) === "true")}
                            size="sm"
                            fullWidth={variant === "inspector"}
                            portalMenu
                            menuPlacement="below"
                            className={variant === "nodeCard" ? "min-w-0 flex-1" : ""}
                        />
                    ) : null}
                    {activeMode === "null" ? (
                        <span className="text-[10px] text-gray-500 italic">no value</span>
                    ) : null}
                </div>
            ) : null}
            {activeMode === "string" ? (
                <Input
                    className={variant === "inspector" ? inputInspector : inputNodeCard}
                    type="text"
                    value={typeof value === "string" ? value : ""}
                    placeholder="Text..."
                    size="sm"
                    fullWidth
                    onChange={e => onChange(e.target.value)}
                />
            ) : null}
            {activeMode === "number" ? (
                <Input
                    className={variant === "inspector" ? inputInspector : inputNodeCard}
                    type="number"
                    value={typeof value === "number" && Number.isFinite(value) ? value : 0}
                    size="sm"
                    fullWidth
                    onChange={e => {
                        const n = Number(e.target.value);
                        onChange(Number.isFinite(n) ? n : 0);
                    }}
                />
            ) : null}
            {activeMode === "json" ? (
                <TextArea
                    className={
                        variant === "inspector"
                            ? `${inputInspector} min-h-[4.5rem] font-mono`
                            : `${inputNodeCard} min-h-[2.25rem] leading-snug`
                    }
                    spellCheck={false}
                    value={jsonDraft}
                    placeholder='e.g. {"a":1} or [1,2]'
                    size="sm"
                    fullWidth
                    onChange={e => setJsonDraft(e.target.value)}
                    onBlur={e => onChange(parseJsonDraft(e.currentTarget.value))}
                />
            ) : null}
        </div>
    );
}
