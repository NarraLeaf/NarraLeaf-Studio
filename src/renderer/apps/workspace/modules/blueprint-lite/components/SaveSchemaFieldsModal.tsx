import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
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
        label: t(`saveSchema.type.${value}` as Parameters<typeof t>[0]),
    }));

    const renameField = useCallback((id: string, name: string) => {
        service?.updateField(id, { name });
    }, [service]);

    const retypeField = useCallback((id: string, valueType: string) => {
        service?.updateField(id, { valueType: valueType as SaveSchemaFieldType });
    }, [service]);

    const setDefault = useCallback((field: SaveSchemaField, raw: string) => {
        service?.updateField(field.id, { defaultValue: parseDefaultValue(field.valueType, raw) as LiteralValue });
    }, [service]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t("saveSchema.title")} size="lg">
            <ModalBody>
                <div className="flex flex-col gap-1.5">
                    {fields.map(field => (
                        <div key={field.id} className="flex items-center gap-1.5">
                            <Input
                                size="sm"
                                className="flex-1"
                                value={field.name}
                                aria-label={t("saveSchema.field.name")}
                                readOnly={freeze.frozen}
                                data-tip={freeze.frozen ? freeze.reason : undefined}
                                onChange={event => renameField(field.id, event.target.value)}
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
                            <Input
                                size="sm"
                                className="w-40"
                                value={formatDefaultValue(field)}
                                placeholder={t("saveSchema.field.defaultPlaceholder")}
                                aria-label={t("saveSchema.field.default")}
                                readOnly={freeze.frozen}
                                data-tip={freeze.frozen ? freeze.reason : undefined}
                                onChange={event => setDefault(field, event.target.value)}
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
 * Unparseable input keeps the type's own empty value rather than throwing or storing the raw text:
 * this runs on every keystroke, so every half-typed number and half-typed object passes through
 * here, and a field that refuses to hold a value mid-word cannot be typed into at all.
 */
function parseDefaultValue(valueType: SaveSchemaFieldType, raw: string): unknown {
    const text = raw.trim();
    switch (valueType) {
        case "boolean":
            return text.toLowerCase() === "true";
        case "integer": {
            const parsed = Number.parseInt(text, 10);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        case "float": {
            const parsed = Number.parseFloat(text);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        case "json":
        case "array": {
            try {
                const parsed = JSON.parse(text || (valueType === "array" ? "[]" : "{}"));
                if (valueType === "array") {
                    return Array.isArray(parsed) ? parsed : [];
                }
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch {
                return valueType === "array" ? [] : {};
            }
        }
        default:
            return raw;
    }
}
