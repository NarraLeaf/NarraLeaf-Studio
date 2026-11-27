import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { arrowKeyStep, beginNumberScrub, evaluateNumericInput, stepNumber } from "@/lib/components/inputs/numericExpression";
import { InputGroupFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";

interface InputGroupFieldProps<TData> {
    field: InputGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function InputGroupField<TData>({ field, data, onSaving }: InputGroupFieldProps<TData>) {
    const [draftById, setDraftById] = useState<Record<string, string>>({});

    const clearDraft = useCallback((itemId: string) => {
        setDraftById((prev) => {
            if (!(itemId in prev)) {
                return prev;
            }
            const { [itemId]: _removed, ...rest } = prev;
            return rest;
        });
    }, []);

    // Number items keep what is being typed here and write it when the field is left or on Enter -
    // the way the size fields beside them do. Writing every keystroke moved the element to 0 the
    // moment the field was cleared or a minus sign typed (`Number("")` is 0), and walked it through
    // 1, then 12, on the way to 120.
    const draftRef = useRef(draftById);
    draftRef.current = draftById;

    // What a number was typed for: the item and data of the render it was typed in. A click on the
    // canvas changes the selection on pointerdown, before the blur that writes the draft, and the
    // item rendered by then belongs to the newly selected element.
    type Item = InputGroupFieldDefinition<TData>["inputs"][number];
    const typedFor = useRef<Record<string, { item: Item; data: TData }>>({});

    const save = useCallback(
        async (item: Item, raw: string, target: TData = data) => {
            if (field.disabled || item.disabled || field.readOnly || item.readOnly) {
                return;
            }
            onSaving(true);
            try {
                await item.setValue(target, raw);
            } catch (error) {
                console.error("InputGroupField: failed to save value", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field.disabled, field.readOnly, onSaving]
    );

    const handleInputChange = useCallback(
        async (item: InputGroupFieldDefinition<TData>["inputs"][number], raw: string) => {
            setDraftById((prev) => ({ ...prev, [item.id]: raw }));
            if (item.type === "number") {
                if (!typedFor.current[item.id]) {
                    typedFor.current[item.id] = { item, data };
                }
                return;
            }
            await save(item, raw);
        },
        [save]
    );

    /** Writes a number item's draft, if one is open and it is a number. */
    const commitNumber = useCallback(
        (item: InputGroupFieldDefinition<TData>["inputs"][number]) => {
            const pending = draftRef.current[item.id];
            const typed = typedFor.current[item.id];
            delete typedFor.current[item.id];
            delete draftRef.current[item.id];
            clearDraft(item.id);
            if (pending === undefined) {
                return;
            }
            const n = evaluateNumericInput(pending);
            if (n !== null) {
                void save(typed?.item ?? item, String(n), typed?.data ?? data);
            }
        },
        [clearDraft, data, save]
    );

    const handleKeyDown = useCallback(
        (item: InputGroupFieldDefinition<TData>["inputs"][number], event: KeyboardEvent<HTMLInputElement>) => {
            if (item.type !== "number") {
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                commitNumber(item);
            } else if (event.key === "Escape" && item.id in draftRef.current) {
                event.preventDefault();
                event.stopPropagation();
                clearDraft(item.id);
                delete draftRef.current[item.id];
                delete typedFor.current[item.id];
                event.currentTarget.blur();
            } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                const current = evaluateNumericInput(draftRef.current[item.id] ?? item.getValue(data));
                if (current !== null) {
                    event.preventDefault();
                    clearDraft(item.id);
                    void save(item, String(stepNumber(current, (event.key === "ArrowUp" ? 1 : -1) * arrowKeyStep(event))));
                }
            }
        },
        [clearDraft, commitNumber, data, save]
    );

    const handleScrub = useCallback(
        (item: InputGroupFieldDefinition<TData>["inputs"][number], event: PointerEvent<HTMLSpanElement>) => {
            const start = evaluateNumericInput(draftRef.current[item.id] ?? item.getValue(data));
            if (start === null) {
                return;
            }
            beginNumberScrub(event, {
                start,
                onPreview: value => setDraftById(prev => ({ ...prev, [item.id]: String(value) })),
                onCommit: value => void save(item, String(value)),
                onEnd: () => clearDraft(item.id),
            });
        },
        [clearDraft, data, save]
    );

    const gap = field.gap ?? 8;
    const shouldWrap = field.wrap ?? true;
    const containerClass = [
        "flex",
        shouldWrap ? "flex-wrap" : "flex-nowrap",
        "items-stretch",
    ].join(" ");

    // Rendered up front so an empty answer takes no slot: the wrapper and the gap before it used to
    // stay when `trailing` returned nothing, and the inputs then ended 8px short of every other row.
    const trailing = field.trailing
        ? field.trailing({ data, onSaving, readOnly: Boolean(field.readOnly || field.disabled) })
        : null;

    return (
        <FieldLayout field={field} className={field.className}>
            <div
                className={containerClass}
                style={{ gap: `${gap}px`, rowGap: `${gap}px`, columnGap: `${gap}px` }}
            >
                {field.inputs.map((item) => {
                    const committed = item.getValue(data);
                    const hasDraft = Object.prototype.hasOwnProperty.call(draftById, item.id);
                    const value = hasDraft ? draftById[item.id] : committed;
                    const itemClassNames = [
                        "flex flex-col flex-1 min-w-0 space-y-1",
                        item.className,
                    ]
                        .filter(Boolean)
                        .join(" ");

                    return (
                        <div key={item.id} className={itemClassNames}>
                            {/* An item with an icon is named by the icon, and its label becomes the
                                field's accessible name and tooltip. Showing both put a row of "X"
                                and "Y" above inputs that already start with an axis glyph, and lifted
                                that group a line below its neighbours. */}
                            {item.label && !item.icon && (
                                <span className="text-2xs text-fg-muted">
                                    {item.label}
                                </span>
                            )}
                            <EnhancedInput
                                value={value}
                                onChange={(next) => handleInputChange(item, next)}
                                onBlur={() => (item.type === "number" ? commitNumber(item) : clearDraft(item.id))}
                                onKeyDown={(event) => handleKeyDown(item, event)}
                                onLeftIconPointerDown={item.type === "number" && item.icon ? (event) => handleScrub(item, event) : undefined}
                                placeholder={item.placeholder}
                                unit={item.unit}
                                leftIcon={item.icon}
                                aria-label={item.label}
                                data-tip={item.icon ? item.label : undefined}
                                // Text, not a native number box: that one reports "" for a lone
                                // minus sign and steps without Shift; this field does both itself.
                                type={item.type === "number" ? "text" : item.type || "text"}
                                inputMode={item.type === "number" ? "decimal" : undefined}
                                disabled={field.disabled || item.disabled}
                                readOnly={field.readOnly || item.readOnly}
                                maxLength={item.maxLength}
                                selectAllOnFocus={item.selectAllOnFocus}
                                precision={item.type === "number" ? (item.precision ?? null) : null}
                                popoverWhenNarrow
                                popoverThreshold={112}
                            />
                        </div>
                    );
                })}
                {trailing ? (
                    // Bottom-aligned: the inputs carry a label above them, and a control that belongs
                    // to the whole group has none, so stretching it would leave it a row too tall.
                    <div className="flex shrink-0 items-end">
                        {trailing}
                    </div>
                ) : null}
            </div>
        </FieldLayout>
    );
}
