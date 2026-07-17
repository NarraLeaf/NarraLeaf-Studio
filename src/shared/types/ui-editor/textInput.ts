/**
 * Single-line text field the player types into.
 *
 * As with the slider, `props.value` is only the value the *author* set as a starting point — the
 * value the player produces lives in `WidgetRuntimeStateStore` for the session and is never written
 * back to the document. See `resolveTextInputRuntimeValue`.
 */

/** `password` masks the glyphs; `number` only constrains the on-screen keyboard and accepted keys. */
export type UITextInputMode = "text" | "password" | "number";

export type UITextInputWidgetProps = {
    value: string;
    placeholder: string;
    /** i18n attach-layer key for `placeholder`; player-facing text is never a Studio catalog key. */
    placeholderLocalizationKey?: string | null;
    inputMode: UITextInputMode;
    /** 0 = unlimited. */
    maxLength: number;
    readOnly: boolean;
    disabled: boolean;
    textAlign: "left" | "center" | "right";
};

export type UITextInputRuntimeValue = {
    value: string;
    /** Length in code points, so an emoji counts once — this is what `maxLength` is measured in. */
    length: number;
};

export const defaultTextInputWidgetProps: UITextInputWidgetProps = {
    value: "",
    placeholder: "",
    placeholderLocalizationKey: null,
    inputMode: "text",
    maxLength: 0,
    readOnly: false,
    disabled: false,
    textAlign: "left",
};

export const UI_TEXT_INPUT_MODES: readonly UITextInputMode[] = ["text", "password", "number"];

function finiteOr(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Code points, not UTF-16 units: `"👍".length` is 2, which would truncate mid-surrogate. */
export function textInputLength(value: string): number {
    return [...value].length;
}

export function clampTextInputValue(value: unknown, maxLengthInput: unknown): string {
    const raw = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
    // A single-line field must not smuggle newlines in via a paste or a blueprint write.
    const flattened = raw.replace(/[\r\n]+/g, " ");
    const maxLength = Math.max(0, Math.floor(finiteOr(maxLengthInput, 0)));
    if (maxLength <= 0) {
        return flattened;
    }
    const points = [...flattened];
    return points.length <= maxLength ? flattened : points.slice(0, maxLength).join("");
}

export function normalizeTextInputProps(raw: Record<string, unknown> | undefined): UITextInputWidgetProps {
    const base = defaultTextInputWidgetProps;
    const inputMode = UI_TEXT_INPUT_MODES.includes(raw?.inputMode as UITextInputMode)
        ? (raw?.inputMode as UITextInputMode)
        : base.inputMode;
    const textAlign =
        raw?.textAlign === "center" || raw?.textAlign === "right" ? raw.textAlign : base.textAlign;
    const maxLength = Math.max(0, Math.floor(finiteOr(raw?.maxLength, base.maxLength)));
    return {
        value: clampTextInputValue(raw?.value ?? base.value, maxLength),
        placeholder: typeof raw?.placeholder === "string" ? raw.placeholder : base.placeholder,
        placeholderLocalizationKey:
            typeof raw?.placeholderLocalizationKey === "string" ? raw.placeholderLocalizationKey : null,
        inputMode,
        maxLength,
        readOnly: raw?.readOnly === true,
        disabled: raw?.disabled === true,
        textAlign,
    };
}

export function resolveTextInputRuntimeValue(raw: Record<string, unknown> | undefined): UITextInputRuntimeValue {
    const props = normalizeTextInputProps(raw);
    return {
        value: props.value,
        length: textInputLength(props.value),
    };
}
