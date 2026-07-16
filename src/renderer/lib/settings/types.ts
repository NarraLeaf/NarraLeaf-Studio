export enum SettingValueType {
    String = "string",
    Number = "number",
    Integer = "integer",
    Boolean = "boolean",
    Enum = "enum",
    /** A bounded number the user drags rather than types; needs `min`/`max`. */
    Slider = "slider",
}

export type TypeofSettingSchema<T extends SettingValueType> =
    T extends SettingValueType.String ? string :
    T extends SettingValueType.Number ? number :
    T extends SettingValueType.Integer ? number :
    T extends SettingValueType.Boolean ? boolean :
    T extends SettingValueType.Enum ? string :
    T extends SettingValueType.Slider ? number :
    never;

export type SettingValueProps<T extends SettingValueType> = T extends SettingValueType.Enum ? {
    options: string[];
} : {};

export type SettingDefinition<T extends SettingValueType> = {
    type: T;
    name: string;
    label: string;
    description: string;
    defaultValue: TypeofSettingSchema<T>;
    validation?: (value: TypeofSettingSchema<T>) => boolean | string;
} & SettingValueProps<T>;
