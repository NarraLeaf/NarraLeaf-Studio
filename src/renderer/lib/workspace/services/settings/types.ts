
export enum RuntimeSettingType {
    String = "string",
    Number = "number",
    Integer = "integer",
    Boolean = "boolean",
    Enum = "enum",
}

export type TypeofSettingSchema<T extends RuntimeSettingType> = 
    T extends RuntimeSettingType.String ? string :
    T extends RuntimeSettingType.Number ? number :
    T extends RuntimeSettingType.Integer ? number :
    T extends RuntimeSettingType.Boolean ? boolean :
    T extends RuntimeSettingType.Enum ? string :
    never;

export type RuntimeSettingProps<T extends RuntimeSettingType> = T extends RuntimeSettingType.Enum ? {
    options: string[];
} : {};

export type RuntimeSettingSchema<T extends RuntimeSettingType> = {
    type: T;
    name: string;
    label: string;
    description: string;
    defaultValue: TypeofSettingSchema<T>;
    /**
     * Returns `true` if the value is valid, a error message if the value is invalid. 
     */
    validation?: (value: TypeofSettingSchema<T>) => boolean | string;
} & RuntimeSettingProps<T>;

export type RuntimeSettingCategory = {
    name: string;
    description: string;
    settings: RuntimeSettingSchema<RuntimeSettingType>[];
};
