export enum SettingValueType {
    String = "string",
    Number = "number",
    Integer = "integer",
    Boolean = "boolean",
    Enum = "enum",
    /**
     * An enum whose options are colors, shown as a row of swatches rather than a dropdown.
     *
     * Still a fixed option list — the stored value is an id, not a hex — because the colors a
     * setting offers are a design decision. Needs `options` plus `optionColors` for the swatch
     * each id paints.
     */
    Color = "color",
    /** A bounded number the user drags rather than types; needs `min`/`max`. */
    Slider = "slider",
    /**
     * A button rather than a value - the one entry kind that stores nothing.
     *
     * Reserved for operations that belong next to the settings they affect but have no state of
     * their own (clearing collected data, resetting a store). Needs `onInvoke`; the explorer
     * requires an inline confirmation before running it, so it is only appropriate for actions
     * worth confirming.
     */
    Action = "action",
    /**
     * A whole panel rather than a value - the entry renders its own UI across the row.
     *
     * Reserved for settings whose editing surface is a table or an editor in its own right (the
     * keyboard-shortcut catalog), where a label plus one control cannot express it. Needs `panel`;
     * the panel owns its storage, so the settings layer reads and writes nothing for it.
     */
    Custom = "custom",
}

export type TypeofSettingSchema<T extends SettingValueType> =
    T extends SettingValueType.String ? string :
    T extends SettingValueType.Number ? number :
    T extends SettingValueType.Integer ? number :
    T extends SettingValueType.Boolean ? boolean :
    T extends SettingValueType.Enum ? string :
    T extends SettingValueType.Color ? string :
    T extends SettingValueType.Slider ? number :
    T extends SettingValueType.Action ? null :
    T extends SettingValueType.Custom ? null :
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
