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
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { needsStructuralReadOnly } from "./fieldReadOnlyStrategy";

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
function FieldRendererInner<TData>({ field: definition, data, onSaving }: FieldRendererProps<TData>) {
    /**
     * A frozen workspace makes every inspector field read-only through the mechanism the framework
     * already has, rather than a second one: `readOnly` is a field-definition flag, so the whole switch
     * below inherits it from one place.
     *
     * A copy, never a write back to `definition`: field definitions come from module schemas that are
     * built once and shared, so setting the flag on the original would leave the inspector read-only
     * after the thaw.
     *
     * `readOnly` is honoured by the text, number, input-group and colour fields; the field types that
     * ignore it are the remaining gap, not a second design.
     */
    const freeze = useFreezeGuard();
    const field = useMemo(
        () => (freeze.frozen ? ({ ...definition, readOnly: true } as FieldDefinition<TData>) : definition),
        [definition, freeze.frozen],
    );

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

    const rendered = renderFieldBody(field, data, onSaving);
    if (!freeze.frozen || !needsStructuralReadOnly(field.type)) {
        return rendered;
    }
    /**
     * The clamp for the field types that cannot honour `readOnly` themselves - see
     * `fieldReadOnlyStrategy` for the measurement that made this necessary.
     *
     * A `disabled` `<fieldset>` because the disabling is then the BROWSER's, not a convention every
     * `render` callback has to remember: per HTML, every form control whose nearest ancestor fieldset is
     * disabled is itself disabled, so a bespoke inline-row `<input>` reports `disabled: true` without
     * knowing this code exists. `display: contents` keeps it out of the layout entirely, so the flex
     * rows the inline-row fields build are untouched (the disabled rule is tree-based, not layout-based)
     * - as an inline style rather than a utility class, because a wrapper whose whole job is to be
     * invisible must not depend on a class having been emitted into the stylesheet.
     * Rendered only while frozen, so the writable path is byte-for-byte what it was.
     */
    return (
        <fieldset disabled aria-readonly style={{ display: "contents" }}>
            {rendered}
        </fieldset>
    );
}

/** The switch itself, split out so the read-only clamp above has something to wrap. */
function renderFieldBody<TData>(
    field: FieldDefinition<TData>,
    data: TData,
    onSaving: (saving: boolean) => void,
): React.ReactNode {
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
                        <label className="block text-xs font-medium text-fg-muted mb-1">
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
