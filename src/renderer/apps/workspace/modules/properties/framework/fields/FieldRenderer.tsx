import { memo, useMemo, type ReactElement } from "react";
import { FieldDefinition } from "../types";
import { BindablePropertyField } from "@/apps/workspace/modules/properties/blueprint/BindablePropertyField";
import { isUIInspectorData, type PropertyFieldBindingMeta } from "@/apps/workspace/modules/properties/blueprint/bindingMeta";
import { TextField } from "./TextField";
import { NumberField } from "./NumberField";
import { CheckboxField } from "./CheckboxField";
import { SelectField } from "./SelectField";
import { TagsField } from "./TagsField";
import { InfoField } from "./InfoField";
import { SectionField } from "./SectionField";
import { ThumbnailField } from "./ThumbnailField";
import { ColorPickerField, ColorPickerGroupField } from "./ColorPickerField";
import { IconButtonGroupField } from "./IconButtonGroupField";
import { DropdownGroupField } from "./DropdownGroupField";
import { MenuTriggerField } from "./MenuTriggerField";
import { InputGroupField } from "./InputGroupField";
import { InlineRowField } from "./InlineRowField";
import { ImageFillField } from "./ImageFillField";
import { FontAssetField } from "./FontAssetField";
import type { FontAssetFieldDefinition, ImageFillFieldDefinition } from "../types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";

interface FieldRendererProps<TData> {
    field: FieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

function wrapBindableField<TData>(
    field: FieldDefinition<TData>,
    data: TData,
    onSaving: (saving: boolean) => void,
    inner: ReactElement,
): React.ReactNode {
    if (!field.binding || !isUIInspectorData(data)) {
        return inner;
    }
    return (
        <BindablePropertyField
            field={
                field as FieldDefinition<UIInspectorData> & {
                    binding: PropertyFieldBindingMeta;
                }
            }
            data={data}
            onSaving={onSaving}
        >
            {inner}
        </BindablePropertyField>
    );
}

/**
 * Renders the appropriate field component based on field type
 */
function FieldRendererInner<TData>({ field, data, onSaving }: FieldRendererProps<TData>) {
    // Check if field should be hidden
    const isHidden = useMemo(() => {
        if (field.hidden === undefined) return false;
        if (typeof field.hidden === "function") {
            return field.hidden(data);
        }
        return field.hidden;
    }, [field.hidden, field.id, data]);

    if (isHidden) {
        return null;
    }

    switch (field.type) {
        case "text":
        case "textarea":
            return wrapBindableField(
                field,
                data,
                onSaving,
                <TextField field={field} data={data} onSaving={onSaving} />,
            );

        case "number":
            return wrapBindableField(
                field,
                data,
                onSaving,
                <NumberField field={field} data={data} onSaving={onSaving} />,
            );

        case "checkbox":
            return wrapBindableField(
                field,
                data,
                onSaving,
                <CheckboxField field={field} data={data} onSaving={onSaving} />,
            );

        case "select":
            return wrapBindableField(
                field,
                data,
                onSaving,
                <SelectField field={field} data={data} onSaving={onSaving} />,
            );

        case "tags":
            return <TagsField field={field} data={data} onSaving={onSaving} />;

        case "info":
            return <InfoField field={field} data={data} />;

        case "section":
            return <SectionField field={field} data={data} onSaving={onSaving} />;

        case "thumbnail":
            return <ThumbnailField field={field} data={data} onSaving={onSaving} />;

        case "colorPicker":
            return <ColorPickerField field={field} data={data} onSaving={onSaving} />;

        case "colorPickerGroup":
            return <ColorPickerGroupField field={field} data={data} onSaving={onSaving} />;

        case "iconButtonGroup":
            return <IconButtonGroupField field={field} data={data} onSaving={onSaving} />;

        case "dropdownGroup":
            return <DropdownGroupField field={field} data={data} onSaving={onSaving} />;

        case "menuTrigger":
            return <MenuTriggerField field={field} data={data} onSaving={onSaving} />;

        case "inputGroup":
            return <InputGroupField field={field} data={data} onSaving={onSaving} />;

        case "inlineRow":
            return <InlineRowField field={field} data={data} onSaving={onSaving} />;

        case "imageFill":
            return (
                <ImageFillField
                    field={field as ImageFillFieldDefinition<UIInspectorData>}
                    data={data as UIInspectorData}
                    onSaving={onSaving}
                />
            );

        case "fontAsset":
            return (
                <FontAssetField
                    field={field as FontAssetFieldDefinition<UIInspectorData>}
                    data={data as UIInspectorData}
                    onSaving={onSaving}
                />
            );

        case "custom": {
            const CustomComponent = field.component;
            return (
                <div className={field.className}>
                    {field.label && (
                        <label className="block text-xs font-medium text-gray-400 mb-1">
                            {field.label}
                        </label>
                    )}
                    <CustomComponent
                        data={data}
                        onChange={() => {
                            // Custom components handle their own state
                        }}
                        disabled={field.disabled}
                        readOnly={field.readOnly}
                    />
                </div>
            );
        }

        default:
            return null;
    }
}

// Memoize to prevent unnecessary re-renders
export const FieldRenderer = memo(FieldRendererInner) as typeof FieldRendererInner;
