import { ReactNode, ComponentType, RefObject } from "react";
import { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { ImageFill, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import type { PropertyFieldBindingMeta } from "@/apps/workspace/modules/properties/blueprint/bindingMeta";

/**
 * Supported field types for property editors
 */
export type FieldType =
    | "text"
    | "textarea"
    | "number"
    | "checkbox"
    | "select"
    | "tags"
    | "custom"
    | "info"
    | "thumbnail"
    | "section"
    | "colorPicker"
    | "colorPickerGroup"
    | "iconButtonGroup"
    | "dropdownGroup"
    | "menuTrigger"
    | "inputGroup"
    | "inlineRow"
    | "imageFill";

/**
 * Base field definition shared by all field types
 */
export interface BaseFieldDefinition<TData = any> {
    /** Unique identifier for the field */
    id: string;
    /** Field type */
    type: FieldType;
    /** Display label */
    label?: string;
    /** Help text shown below the field */
    helpText?: string;
    /** Placeholder text */
    placeholder?: string;
    /** Whether the field is read-only */
    readOnly?: boolean;
    /** Whether the field is disabled */
    disabled?: boolean;
    /** Whether the field is hidden */
    hidden?: boolean | ((data: TData) => boolean);
    /** Custom class name */
    className?: string;
    /** Field order (lower values appear first) */
    order?: number;
    /** When set on UI inspector fields, shows Literal / Bound / Broken and blueprint actions. */
    binding?: PropertyFieldBindingMeta;
}

/**
 * Text field definition
 */
export interface TextFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "text";
    /** Maximum length */
    maxLength?: number;
    /** Getter function to extract value from data */
    getValue: (data: TData) => string;
    /** Setter function to update data with new value */
    setValue: (data: TData, value: string) => void | Promise<void>;
}

/**
 * Textarea field definition
 */
export interface TextareaFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "textarea";
    /** Number of rows */
    rows?: number;
    /** Maximum length */
    maxLength?: number;
    getValue: (data: TData) => string;
    setValue: (data: TData, value: string) => void | Promise<void>;
}

/**
 * Number field definition
 */
export interface NumberFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "number";
    /** Minimum value */
    min?: number;
    /** Maximum value */
    max?: number;
    /** Step increment */
    step?: number;
    /** Number of decimal places to format when displaying */
    decimalPlaces?: number;
    getValue: (data: TData) => number;
    setValue: (data: TData, value: number) => void | Promise<void>;
}

/**
 * Checkbox field definition
 */
export interface CheckboxFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "checkbox";
    getValue: (data: TData) => boolean;
    setValue: (data: TData, value: boolean) => void | Promise<void>;
}

/**
 * Select option definition
 */
export interface SelectOption {
    value: string | number;
    label: string;
    disabled?: boolean;
}

/**
 * Select field definition
 */
export interface SelectFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "select";
    /** Available options */
    options: SelectOption[] | ((data: TData) => SelectOption[]);
    getValue: (data: TData) => string | number;
    setValue: (data: TData, value: string | number) => void | Promise<void>;
}

export type ColorMode = "hex" | "rgb" | "hsl";

export type ColorDisplayMode = "icon" | "icon-hex";

export interface ColorValue {
    hex: string;
    alpha?: number;
}

export interface ColorPickerFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "colorPicker";
    /** How the trigger displays the selected color */
    displayMode?: ColorDisplayMode;
    /** Allowed color modes shown in the picker */
    colorModes?: ColorMode[];
    getValue: (data: TData) => ColorValue;
    setValue: (data: TData, value: ColorValue) => void | Promise<void>;
    /** Whether opacity is editable inside the picker */
    allowOpacity?: boolean;
}

export interface ColorPickerGroupFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "colorPickerGroup";
    displayMode?: ColorDisplayMode;
    colorModes?: ColorMode[];
    getValue: (data: TData) => ColorValue;
    setValue: (data: TData, value: ColorValue) => void | Promise<void>;
}

export type IconButtonGroupMode = "trigger" | "multiple" | "single";

export interface IconButtonGroupOption {
    id: string;
    icon: ReactNode;
    label?: string;
    disabled?: boolean;
}

export type IconButtonSelection = string | string[] | null;

export interface IconButtonGroupFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "iconButtonGroup";
    mode?: IconButtonGroupMode;
    options: IconButtonGroupOption[];
    getValue: (data: TData) => IconButtonSelection;
    setValue: (data: TData, value: IconButtonSelection) => void | Promise<void>;
    /** Whether to show option labels next to icons */
    showLabels?: boolean;
}

export interface DropdownGroupItem<TData = any> {
    id: string;
    label?: string;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    getValue: (data: TData) => string | number | null;
    setValue: (data: TData, value: string | number) => void | Promise<void>;
    className?: string;
}

export interface DropdownGroupFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "dropdownGroup";
    dropdowns: DropdownGroupItem<TData>[];
    gap?: number;
    wrap?: boolean;
}

export interface MenuTriggerFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "menuTrigger";
    menu: ContextMenuDef;
    buttonAriaLabel?: string;
    icon?: ReactNode;
}

export interface InputGroupItem<TData = any> {
    id: string;
    label?: string;
    placeholder?: string;
    unit?: string;
    icon?: ReactNode;
    type?: "text" | "number" | "search" | "tel" | "url" | "email";
    disabled?: boolean;
    readOnly?: boolean;
    maxLength?: number;
    className?: string;
    selectAllOnFocus?: boolean;
    getValue: (data: TData) => string;
    setValue: (data: TData, value: string) => void | Promise<void>;
}

export interface InputGroupFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "inputGroup";
    inputs: InputGroupItem<TData>[];
    gap?: number;
    wrap?: boolean;
}

export interface InlineRowItemContext<TData = any> {
    data: TData;
    onSaving: (saving: boolean) => void;
}

export interface InlineRowItem<TData = any> {
    id: string;
    className?: string;
    render: (context: InlineRowItemContext<TData>) => ReactNode;
}

export interface InlineRowFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "inlineRow";
    items: InlineRowItem<TData>[];
    gap?: number;
    wrap?: boolean;
}

/**
 * Tags field definition
 */
export interface TagsFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "tags";
    /** Placeholder for the add tag input */
    addPlaceholder?: string;
    getValue: (data: TData) => string[];
    addTag: (data: TData, tag: string) => void | Promise<void>;
    removeTag: (data: TData, tag: string) => void | Promise<void>;
}

/**
 * Info field definition (read-only display)
 */
export interface InfoFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "info";
    /** Info items to display */
    items: InfoItem<TData>[] | ((data: TData) => InfoItem<TData>[]);
}

/**
 * Info item for info field
 */
export interface InfoItem<TData = any> {
    label: string;
    getValue: (data: TData) => ReactNode;
    hidden?: boolean | ((data: TData) => boolean);
}

/**
 * Section field definition (grouping)
 */
export interface SectionFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "section";
    /** Section title */
    title: string;
    /** Nested fields */
    fields: FieldDefinition<TData>[];
    /** Whether the section is collapsible */
    collapsible?: boolean;
    /** Whether the section is collapsed by default */
    defaultCollapsed?: boolean;
}

/**
 * Custom component props
 */
export interface CustomFieldProps<TData = any> {
    data: TData;
    onChange: (data: TData) => void;
    disabled?: boolean;
    readOnly?: boolean;
}

/**
 * Custom field definition (for complex custom components)
 */
export interface CustomFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "custom";
    /** Custom component to render */
    component: ComponentType<CustomFieldProps<TData>>;
}

/**
 * Thumbnail field definition
 */
export interface ThumbnailFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "thumbnail";
    /** Get thumbnail URL or null */
    getThumbnailUrl: (data: TData) => string | null | Promise<string | null>;
    /** Get thumbnail ID or null */
    getThumbnailId: (data: TData) => string | null;
    /** Set thumbnail (called after cropping) */
    setThumbnail: (data: TData, id: string | null) => void | Promise<void>;
    /** Aspect ratio for cropping (default 1 = square) */
    aspectRatio?: number;
    /** Anchor ref for selector popup positioning */
    anchorRef?: RefObject<HTMLElement>;
}

export interface ImageFillFieldDefinition<TData = any> extends BaseFieldDefinition<TData> {
    type: "imageFill";
    getValue: (data: TData) => ImageFill | undefined;
    setValue: (data: TData, value: ImageFill) => void | Promise<void>;
    /** When set, mode dropdown and canvas crop are limited to these modes (e.g. nl.image has no crop overlay). */
    allowedFillModes?: ImageFillMode[];
}

/**
 * Union of all field definitions
 */
export type FieldDefinition<TData = any> =
    | TextFieldDefinition<TData>
    | TextareaFieldDefinition<TData>
    | NumberFieldDefinition<TData>
    | CheckboxFieldDefinition<TData>
    | SelectFieldDefinition<TData>
    | TagsFieldDefinition<TData>
    | InfoFieldDefinition<TData>
    | SectionFieldDefinition<TData>
    | CustomFieldDefinition<TData>
    | ThumbnailFieldDefinition<TData>
    | ColorPickerFieldDefinition<TData>
    | ColorPickerGroupFieldDefinition<TData>
    | IconButtonGroupFieldDefinition<TData>
    | DropdownGroupFieldDefinition<TData>
    | MenuTriggerFieldDefinition<TData>
    | InputGroupFieldDefinition<TData>
    | InlineRowFieldDefinition<TData>
    | ImageFillFieldDefinition<TData>;

/**
 * Property editor schema definition
 */
export interface PropertyEditorTab<TData = any> {
    /** Unique tab identifier */
    id: string;
    /** Tab label */
    title: string;
    /** Fields shown inside this tab */
    fields: FieldDefinition<TData>[];
    /** Optional ordering weight */
    order?: number;
}

export interface PropertyEditorSchema<TData = any> {
    /** Unique identifier for this editor type */
    id: string;
    /** Display title */
    title?: string;
    /** Field definitions */
    fields: FieldDefinition<TData>[];
    /** Optional tab configuration */
    tabs?: PropertyEditorTab<TData>[];
    /** Preferred tab to show when schema loads */
    defaultTabId?: string;
    /** Called when any field changes */
    onFieldChange?: (data: TData, fieldId: string, value: any) => void | Promise<void>;
    /** Whether to show saving indicator */
    showSavingIndicator?: boolean;
}

/**
 * Selection types that can trigger property editors
 */
export type SelectionType = "asset" | "character" | "element" | "scene" | null;

/**
 * Property editor registration
 */
export interface PropertyEditorRegistration<TData = any> {
    /** Selection type this editor handles */
    selectionType: SelectionType;
    /** Optional predicate to further filter when this editor applies */
    when?: (data: any) => boolean;
    /** The schema for this editor */
    schema: PropertyEditorSchema<TData>;
    /** Priority (higher values take precedence) */
    priority?: number;
}

/**
 * Property editor context state
 */
export interface PropertyEditorState<TData = any> {
    /** Current data being edited */
    data: TData | null;
    /** Selection type */
    selectionType: SelectionType;
    /** Whether currently saving */
    isSaving: boolean;
    /** Current error message */
    error: string | null;
}

