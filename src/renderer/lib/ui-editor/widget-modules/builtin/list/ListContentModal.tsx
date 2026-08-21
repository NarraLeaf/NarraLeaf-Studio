import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import { Button, IconButton, Input, Modal, ModalBody, Select, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { isBuiltinUIStructId } from "@shared/types/ui-editor/builtinStructs";
import {
    UI_STRUCT_FIELD_TYPES,
    coerceItemToStruct,
    defaultUIStructFieldValue,
    makeDefaultStructItem,
    uiStructFieldLabel,
    type UIStructDef,
    type UIStructField,
    type UIStructFieldType,
} from "@shared/types/ui-editor/struct";

/**
 * Where an author writes what a list is made of.
 *
 * A modal for the reason the save-fields editor is one: a table needs width and the inspector panel
 * has none, and the two halves have to be looked at together - a column is only meaningful next to
 * the values under it. Before this, `items` had no editor anywhere in the product, so the only way
 * to give a list real content was to write a graph that produced it, and the only thing the canvas
 * could show was a row of blanks.
 *
 * Edits land on the document immediately. Closing is not a commit: the same undo that takes back a
 * moved widget takes back a typed cell.
 */
export function ListContentModal(props: {
    isOpen: boolean;
    onClose: () => void;
    struct: UIStructDef | null;
    structId: string | null;
    items: readonly unknown[];
    onFieldsChange: (fields: UIStructField[]) => void;
    onItemsChange: (items: unknown[]) => void;
    generateFieldId: () => string;
}): React.ReactNode {
    const { isOpen, onClose, struct, structId, items, onFieldsChange, onItemsChange, generateFieldId } = props;
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const fieldsLocked = isBuiltinUIStructId(structId);
    const readOnly = freeze.frozen;

    const fields = struct?.fields ?? [];

    const typeOptions = useMemo(
        () =>
            UI_STRUCT_FIELD_TYPES.map(value => ({
                value,
                label: t(`struct.type.${value}` as Parameters<typeof t>[0]),
            })),
        [t],
    );

    /**
     * Rewrite the rows alongside the shape.
     *
     * A rename moves the values with the key, and a retype reads what is there as the new type -
     * both of which mean an author can fix a column they got wrong without losing what they typed
     * under it. Only a removed field drops values, which is the one case where there is nowhere for
     * them to go.
     */
    const applyFields = useCallback(
        (nextFields: UIStructField[], rename?: { from: string; to: string }) => {
            onFieldsChange(nextFields);
            const nextStruct: UIStructDef = { id: structId ?? "", fields: nextFields };
            onItemsChange(
                items.map(item => {
                    const source =
                        item && typeof item === "object" && !Array.isArray(item)
                            ? { ...(item as Record<string, unknown>) }
                            : {};
                    if (rename && rename.from !== rename.to && rename.from in source) {
                        source[rename.to] = source[rename.from];
                        delete source[rename.from];
                    }
                    return coerceItemToStruct(nextStruct, source);
                }),
            );
        },
        [items, onFieldsChange, onItemsChange, structId],
    );

    const renameField = useCallback(
        (fieldId: string, key: string) => {
            const previous = fields.find(field => field.id === fieldId);
            if (!previous) {
                return;
            }
            applyFields(
                fields.map(field => (field.id === fieldId ? { ...field, key } : field)),
                { from: previous.key, to: key },
            );
        },
        [applyFields, fields],
    );

    const retypeField = useCallback(
        (fieldId: string, type: UIStructFieldType) => {
            applyFields(fields.map(field => (field.id === fieldId ? { ...field, type } : field)));
        },
        [applyFields, fields],
    );

    const removeField = useCallback(
        (fieldId: string) => {
            applyFields(fields.filter(field => field.id !== fieldId));
        },
        [applyFields, fields],
    );

    const addField = useCallback(() => {
        // Numbered from the count so a second add cannot collide with the first, which would be
        // dropped on read as a duplicate key and look like the button did nothing.
        const used = new Set(fields.map(field => field.key));
        let ordinal = fields.length + 1;
        let key = `${t("struct.field.newName")}${ordinal}`;
        while (used.has(key)) {
            ordinal += 1;
            key = `${t("struct.field.newName")}${ordinal}`;
        }
        applyFields([...fields, { id: generateFieldId(), key, type: "string" }]);
    }, [applyFields, fields, generateFieldId, t]);

    const setCell = useCallback(
        (rowIndex: number, key: string, value: unknown) => {
            onItemsChange(
                items.map((item, index) => {
                    if (index !== rowIndex) {
                        return item;
                    }
                    const source =
                        item && typeof item === "object" && !Array.isArray(item)
                            ? (item as Record<string, unknown>)
                            : {};
                    return { ...source, [key]: value };
                }),
            );
        },
        [items, onItemsChange],
    );

    const addRow = useCallback(() => {
        onItemsChange([...items, makeDefaultStructItem(struct)]);
    }, [items, onItemsChange, struct]);

    const removeRow = useCallback(
        (rowIndex: number) => {
            onItemsChange(items.filter((_, index) => index !== rowIndex));
        },
        [items, onItemsChange],
    );

    const duplicateRow = useCallback(
        (rowIndex: number) => {
            const next = [...items];
            next.splice(rowIndex + 1, 0, JSON.parse(JSON.stringify(items[rowIndex] ?? {})));
            onItemsChange(next);
        },
        [items, onItemsChange],
    );

    const moveRow = useCallback(
        (rowIndex: number, delta: number) => {
            const target = rowIndex + delta;
            if (target < 0 || target >= items.length) {
                return;
            }
            const next = [...items];
            const [moved] = next.splice(rowIndex, 1);
            next.splice(target, 0, moved);
            onItemsChange(next);
        },
        [items, onItemsChange],
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t("widgets.list.contentTitle")} size="xl">
            <ModalBody>
                <div className="flex flex-col gap-4">
                    <section className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-fg-muted">{t("widgets.list.fields")}</span>
                            {fieldsLocked ? (
                                <span className="text-2xs text-fg-subtle">{t("struct.field.engineOwned")}</span>
                            ) : null}
                        </div>
                        {fields.map(field => (
                            <div key={field.id} className="flex items-center gap-1.5">
                                <Input
                                    size="sm"
                                    className="flex-1"
                                    value={field.key}
                                    aria-label={t("struct.field.name")}
                                    readOnly={readOnly || fieldsLocked}
                                    data-tip={readOnly ? freeze.reason : undefined}
                                    onChange={event => renameField(field.id, event.target.value)}
                                />
                                <Select
                                    size="sm"
                                    className="w-32"
                                    value={field.type}
                                    options={typeOptions}
                                    portalMenu
                                    disabled={readOnly || fieldsLocked}
                                    ariaLabel={t("struct.field.type")}
                                    onChange={value => retypeField(field.id, String(value) as UIStructFieldType)}
                                />
                                <IconButton
                                    size="sm"
                                    variant="ghost"
                                    aria-label={t("struct.field.remove")}
                                    disabled={readOnly || fieldsLocked}
                                    data-tip={readOnly ? freeze.reason : t("struct.field.remove")}
                                    onClick={() => removeField(field.id)}
                                >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                </IconButton>
                            </div>
                        ))}
                        {fieldsLocked ? null : (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="flex w-full items-center justify-center rounded-md border border-dashed border-edge text-fg-subtle hover:border-edge-strong hover:bg-fill hover:text-fg-muted"
                                aria-label={t("struct.field.add")}
                                disabled={readOnly}
                                data-tip={readOnly ? freeze.reason : t("struct.field.add")}
                                onClick={addField}
                            >
                                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                            </Button>
                        )}
                    </section>

                    <section className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-xs font-medium text-fg-muted">{t("widgets.list.rows")}</span>
                        {fields.length === 0 ? (
                            <p className="text-2xs text-fg-subtle">{t("struct.field.none")}</p>
                        ) : (
                            <div className="min-w-0 overflow-x-auto">
                                <table className="w-full min-w-max border-separate border-spacing-y-1 text-xs">
                                    <thead>
                                        <tr className="text-left text-2xs text-fg-subtle">
                                            <th className="w-8 pr-1 font-medium">{t("struct.row.number")}</th>
                                            {fields.map(field => (
                                                <th key={field.id} className="min-w-[9rem] px-1 font-medium">
                                                    {uiStructFieldLabel(field)}
                                                </th>
                                            ))}
                                            <th className="w-24" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, rowIndex) => (
                                            <tr key={rowIndex}>
                                                <td className="pr-1 align-middle text-2xs text-fg-subtle">
                                                    {rowIndex + 1}
                                                </td>
                                                {fields.map(field => (
                                                    <td key={field.id} className="px-1 align-middle">
                                                        <StructCell
                                                            field={field}
                                                            value={readCell(item, field.key)}
                                                            readOnly={readOnly}
                                                            freezeReason={freeze.reason}
                                                            onChange={value => setCell(rowIndex, field.key, value)}
                                                        />
                                                    </td>
                                                ))}
                                                <td className="align-middle">
                                                    <div className="flex items-center justify-end gap-0.5">
                                                        <IconButton
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t("struct.row.moveUp")}
                                                            disabled={readOnly || rowIndex === 0}
                                                            data-tip={t("struct.row.moveUp")}
                                                            onClick={() => moveRow(rowIndex, -1)}
                                                        >
                                                            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                                        </IconButton>
                                                        <IconButton
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t("struct.row.moveDown")}
                                                            disabled={readOnly || rowIndex === items.length - 1}
                                                            data-tip={t("struct.row.moveDown")}
                                                            onClick={() => moveRow(rowIndex, 1)}
                                                        >
                                                            <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                                        </IconButton>
                                                        <IconButton
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t("struct.row.duplicate")}
                                                            disabled={readOnly}
                                                            data-tip={t("struct.row.duplicate")}
                                                            onClick={() => duplicateRow(rowIndex)}
                                                        >
                                                            <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                                        </IconButton>
                                                        <IconButton
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t("struct.row.remove")}
                                                            disabled={readOnly}
                                                            data-tip={t("struct.row.remove")}
                                                            onClick={() => removeRow(rowIndex)}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                                        </IconButton>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {fields.length === 0 ? null : (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="flex w-full items-center justify-center rounded-md border border-dashed border-edge text-fg-subtle hover:border-edge-strong hover:bg-fill hover:text-fg-muted"
                                aria-label={t("struct.row.add")}
                                disabled={readOnly}
                                data-tip={readOnly ? freeze.reason : t("struct.row.add")}
                                onClick={addRow}
                            >
                                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                            </Button>
                        )}
                    </section>
                </div>
            </ModalBody>
        </Modal>
    );
}

function readCell(item: unknown, key: string): unknown {
    return item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)[key]
        : undefined;
}

function StructCell(props: {
    field: UIStructField;
    value: unknown;
    readOnly: boolean;
    freezeReason?: string;
    onChange: (value: unknown) => void;
}): React.ReactNode {
    const { field, value, readOnly, freezeReason, onChange } = props;
    const { t } = useTranslation();
    const label = uiStructFieldLabel(field);

    if (field.type === "boolean") {
        return (
            <Switch
                size="sm"
                checked={value === true}
                disabled={readOnly}
                aria-label={label}
                onCheckedChange={next => onChange(next)}
            />
        );
    }

    if (field.type === "image") {
        return <StructImageCell value={value} readOnly={readOnly} label={label} onChange={onChange} />;
    }

    if (field.type === "number") {
        return (
            <Input
                size="sm"
                type="number"
                inputMode="decimal"
                className="w-full"
                value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
                aria-label={label}
                readOnly={readOnly}
                data-tip={readOnly ? freezeReason : undefined}
                onChange={event => {
                    const parsed = Number(event.target.value);
                    onChange(Number.isFinite(parsed) ? parsed : 0);
                }}
            />
        );
    }

    if (field.type === "color") {
        return (
            <Input
                size="sm"
                className="w-full"
                value={typeof value === "string" ? value : ""}
                placeholder="#000000"
                aria-label={label}
                readOnly={readOnly}
                data-tip={readOnly ? freezeReason : undefined}
                onChange={event => onChange(event.target.value)}
            />
        );
    }

    if (field.type === "json") {
        // Shown and typed as JSON text because that is what the value is. Unparseable input keeps
        // the last readable value rather than throwing: this runs on every keystroke, so a
        // half-typed object passes through here on the way to a whole one.
        return (
            <Input
                size="sm"
                className="w-full font-mono"
                value={value === null || value === undefined ? "" : JSON.stringify(value)}
                aria-label={label}
                readOnly={readOnly}
                data-tip={readOnly ? freezeReason : undefined}
                onChange={event => {
                    const text = event.target.value.trim();
                    if (!text) {
                        onChange(null);
                        return;
                    }
                    try {
                        onChange(JSON.parse(text));
                    } catch {
                        // Keep what is stored; the field shows the text the author is still typing.
                    }
                }}
            />
        );
    }

    return (
        <Input
            size="sm"
            className="w-full"
            value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)}
            aria-label={label}
            readOnly={readOnly}
            data-tip={readOnly ? freezeReason : undefined}
            onChange={event => onChange(event.target.value)}
        />
    );
}

/**
 * A picture in a table cell.
 *
 * A thumbnail-sized button rather than the node card's picker: a column of 82px cards would make a
 * four-row list taller than the screen, and what identifies a picture at a glance is the picture.
 */
function StructImageCell(props: {
    value: unknown;
    readOnly: boolean;
    label: string;
    onChange: (value: unknown) => void;
}): React.ReactNode {
    const { value, readOnly, label, onChange } = props;
    const { t } = useTranslation();
    const { isInitialized } = useWorkspace();
    const [selectorOpen, setSelectorOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const assetId =
        value && typeof value === "object" && !Array.isArray(value)
            ? (typeof (value as { assetId?: unknown }).assetId === "string"
                  ? ((value as { assetId: string }).assetId || null)
                  : null)
            : typeof value === "string" && value.trim()
              ? value.trim()
              : null;
    const { url } = useAssetObjectUrl(assetId);

    return (
        <div className="flex items-center gap-1">
            <button
                ref={anchorRef}
                type="button"
                disabled={readOnly || !isInitialized}
                aria-label={label}
                data-tip={t("struct.image.select")}
                className={cn(
                    "relative h-7 w-12 shrink-0 overflow-hidden rounded-md border border-edge bg-fill-subtle",
                    readOnly ? "cursor-default opacity-60" : "hover:border-edge-strong hover:bg-fill",
                )}
                onClick={() => setSelectorOpen(true)}
            >
                {url ? (
                    <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                ) : (
                    <span className="flex h-full w-full items-center justify-center text-fg-subtle">
                        <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                    </span>
                )}
            </button>
            {assetId && !readOnly ? (
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t("struct.image.clear")}
                    data-tip={t("struct.image.clear")}
                    onClick={() => onChange(null)}
                >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                </IconButton>
            ) : null}
            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={anchorRef}
                title={t("struct.image.selectTitle")}
                multiple={false}
                onClose={() => setSelectorOpen(false)}
                onConfirm={(assets: Asset[]) => {
                    const selected = assets[0];
                    onChange(selected ? { kind: "imageAsset", assetId: selected.id } : null);
                    setSelectorOpen(false);
                }}
            />
        </div>
    );
}

/** Exported so the inspector can show the same empty value the table writes. */
export { defaultUIStructFieldValue };
