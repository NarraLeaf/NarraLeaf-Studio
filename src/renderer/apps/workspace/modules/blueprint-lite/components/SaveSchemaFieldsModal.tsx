import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatBlueprintValueTypeLabel } from "@/lib/ui-editor/blueprint-nodes/structTypeLabels";
import { Button, IconButton, Input, Modal, ModalBody, Select } from "@/lib/components/elements";
import type { LiteralValue } from "@shared/types/blueprint/document";
import { SAVE_SCHEMA_FIELD_TYPES, type SaveSchemaField, type SaveSchemaFieldType } from "@shared/types/saveSchema";
import { SaveSchemaService } from "@/lib/workspace/services/saves/SaveSchemaService";
import { Services } from "@/lib/workspace/services/services";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useWorkspace } from "../../../context";

/**
 * The project's save fields, edited from the card of the node that grows pins for them.
 *
 * A modal rather than a panel because the schema has no home of its own: an author is asked what a
 * slot carries at the moment they are wiring one, and a fifth project table in the sidebar would
 * send them elsewhere to answer a question being asked here. A modal rather than a floating card on
 * the canvas because the canvas is a transformed surface - a popover inside it is scaled by the
 * zoom, and a text field that shrinks with the graph is not one anybody can type in.
 *
 * Edits land on the service immediately: it is the same document either way, it autosaves, and the
 * blueprint history channel already captures it, so closing this is not a commit and Ctrl+Z on the
 * canvas undoes a field exactly like it undoes an edge.
 */
export function SaveSchemaFieldsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }): React.ReactNode {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const service = context?.services.get<SaveSchemaService>(Services.SaveSchema);
    const [fields, setFields] = useState<SaveSchemaField[]>(() => service?.listFields() ?? []);

    useEffect(() => {
        if (!service) {
            return;
        }
        setFields(service.listFields());
        return service.onSchemaChanged(() => setFields(service.listFields()));
    }, [service]);

    const typeOptions = SAVE_SCHEMA_FIELD_TYPES.map(value => ({
        value,
        label: formatBlueprintValueTypeLabel(value, t, "option"),
    }));

    const renameField = useCallback((field: SaveSchemaField, name: string) => {
        const trimmed = name.trim();
        if (trimmed && trimmed !== field.name) {
            service?.updateField(field.id, { name: trimmed });
        }
    }, [service]);

    const retypeField = useCallback((id: string, valueType: string) => {
        service?.updateField(id, { valueType: valueType as SaveSchemaFieldType });
    }, [service]);

    const setDefault = useCallback((field: SaveSchemaField, raw: string) => {
        const value = parseDefaultValue(field.valueType, raw);
        if (value !== undefined) {
            service?.updateField(field.id, { defaultValue: value });
        }
    }, [service]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t("saveSchema.title")} size="lg">
            <ModalBody>
                <div className="flex flex-col gap-1.5">
                    {fields.map(field => (
                        <div key={field.id} className="flex items-center gap-1.5">
                            <SaveSchemaTextInput
                                className="flex-1"
                                value={field.name}
                                ariaLabel={t("saveSchema.field.name")}
                                readOnly={freeze.frozen}
                                tip={freeze.frozen ? freeze.reason : undefined}
                                onChange={value => renameField(field, value)}
                            />
                            <Select
                                size="sm"
                                className="w-32"
                                value={field.valueType}
                                options={typeOptions}
                                portalMenu
                                disabled={freeze.frozen}
                                ariaLabel={t("saveSchema.field.type")}
                                onChange={value => retypeField(field.id, String(value))}
                            />
                            <SaveSchemaTextInput
                                className="w-40"
                                value={formatDefaultValue(field)}
                                placeholder={t("saveSchema.field.defaultPlaceholder")}
                                ariaLabel={t("saveSchema.field.default")}
                                readOnly={freeze.frozen}
                                tip={freeze.frozen ? freeze.reason : undefined}
                                onChange={value => setDefault(field, value)}
                            />
                            <IconButton
                                size="sm"
                                variant="ghost"
                                aria-label={t("saveSchema.field.remove")}
                                disabled={freeze.frozen}
                                data-tip={freeze.frozen ? freeze.reason : t("saveSchema.field.remove")}
                                onClick={() => service?.deleteField(field.id)}
                            >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                            </IconButton>
                        </div>
                    ))}
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="flex w-full items-center justify-center rounded-md border border-dashed border-edge text-fg-subtle hover:border-edge-strong hover:bg-fill hover:text-fg-muted"
                        aria-label={t("saveSchema.field.add")}
                        disabled={freeze.frozen}
                        data-tip={freeze.frozen ? freeze.reason : t("saveSchema.field.add")}
                        onClick={() => service?.createField({ name: t("saveSchema.field.newName") })}
                    >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                    </Button>
                </div>
            </ModalBody>
        </Modal>
    );
}

function SaveSchemaTextInput({
    value, onChange, className, ariaLabel, placeholder, readOnly, tip,
}: {
    value: string;
    onChange: (value: string) => void;
    className: string;
    ariaLabel: string;
    placeholder?: string;
    readOnly: boolean;
    tip?: string;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <Input
            size="sm"
            className={className}
            value={draft ?? value}
            placeholder={placeholder}
            aria-label={ariaLabel}
            readOnly={readOnly}
            data-tip={tip}
            onBlur={() => setDraft(null)}
            onChange={event => {
                setDraft(event.target.value);
                onChange(event.target.value);
            }}
        />
    );
}

/**
 * A field's default, as one line of text.
 *
 * The structured types are shown as their JSON because that is what they are on disk, and an author
 * who declared a `json` field is already thinking in it. A string is shown bare - quoting it here
 * would make the quotes part of what they type.
 */
function formatDefaultValue(field: SaveSchemaField): string {
    const value = field.defaultValue;
    if (value === undefined || value === null) {
        return "";
    }
    if (field.valueType === "string") {
        return String(value);
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Read one line of text back into a default of the field's type.
 *
 * An unfinished value stays in the input until it can be parsed. It is not written to the schema.
 */
function parseDefaultValue(valueType: SaveSchemaFieldType, raw: string): LiteralValue | undefined {
    const text = raw.trim();
    switch (valueType) {
        case "boolean":
            return text.toLowerCase() === "true" ? true : text.toLowerCase() === "false" ? false : undefined;
        case "integer": {
            const parsed = Number(text);
            return text && Number.isInteger(parsed) ? parsed : undefined;
        }
        case "float": {
            const parsed = Number(text);
            return text && Number.isFinite(parsed) ? parsed : undefined;
        }
        case "json":
        case "array": {
            try {
                const parsed = JSON.parse(text);
                if (valueType === "array") {
                    return Array.isArray(parsed) ? parsed : undefined;
                }
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
            } catch {
                return undefined;
            }
        }
        default:
            return raw;
    }
}
