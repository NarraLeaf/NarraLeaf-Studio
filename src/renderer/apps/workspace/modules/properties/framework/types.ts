import { ReactNode, ComponentType, RefObject } from "react";

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
    | "section";

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
    | ThumbnailFieldDefinition<TData>;

/**
 * Property editor schema definition
 */
export interface PropertyEditorSchema<TData = any> {
    /** Unique identifier for this editor type */
    id: string;
    /** Display title */
    title?: string;
    /** Field definitions */
    fields: FieldDefinition<TData>[];
    /** Called when any field changes */
    onFieldChange?: (data: TData, fieldId: string, value: any) => void | Promise<void>;
    /** Whether to show saving indicator */
    showSavingIndicator?: boolean;
}

/**
 * Selection types that can trigger property editors
 */
export type SelectionType = "asset" | "character" | "node" | "scene" | null;

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

