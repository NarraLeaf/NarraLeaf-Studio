export enum SettingValueType {
    String = "string",
    Number = "number",
    Integer = "integer",
    Boolean = "boolean",
    Enum = "enum",
    /**
     * A download address offered as a short list of known sources, with "custom" as the last
     * answer and a field for it.
     *
     * Still a plain string in storage, and still the "empty means official" convention every
     * source setting documents (see `resolveDownloadSource`) - the official entry stores `""`.
     * `options` carries the preset addresses in the order they are offered; anything stored that
     * is not one of them is a custom address and shows in the field.
     *
     * The type exists because these settings have two audiences at once: an author on a slow
     * network needs a mirror they could not have been expected to know the address of, and an
     * author running their own registry needs to type one. A bare text field served only the
     * second, and a bare dropdown would take the second away.
     */
    Source = "source",
    /**
     * An enum whose options are colors, shown as a row of swatches rather than a dropdown.
     *
     * Still a fixed option list — the stored value is an id, not a hex — because the colors a
     * setting offers are a design decision. Needs `options` plus `optionColors` for the swatch
     * each id paints.
     */
    Color = "color",
    /**
     * A font family, chosen from a searchable list of the presets plus everything installed on this
     * computer.
     *
     * Unlike `Enum` the option list is not fixed — it is discovered at open time and differs per
     * machine — so the stored string is any family name, and `options` carries only the presets.
     */
    Font = "font",
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
    T extends SettingValueType.Source ? string :
    T extends SettingValueType.Color ? string :
    T extends SettingValueType.Font ? string :
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
