import { en } from "./en";

/** The full message tree, shape-defined by the English source catalog. */
export type Messages = typeof en;

type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Same tree as {@link Messages} but every leaf widened to `string`. */
type Stringify<T> = {
    [K in keyof T]: T[K] extends string ? string : Stringify<T[K]>;
};

/**
 * Shape a non-source locale must satisfy: any subset of the source keys, with
 * `string` values. Missing keys fall back to the source locale at runtime, so a
 * locale can be translated incrementally. Typos and stray keys are still errors.
 */
export type LocaleMessages = DeepPartial<Stringify<Messages>>;

type Flatten<T, Prefix extends string = ""> = {
    [K in keyof T & string]: T[K] extends string
        ? `${Prefix}${K}`
        : Flatten<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid dotted message key, derived from the source catalog. */
export type TranslationKey = Flatten<Messages>;

type PluralBaseOf<K> = K extends `${infer Base}.other` ? Base : never;

/** Keys that carry plural sub-forms (a `.other` leaf exists). Used by `tn()`. */
export type PluralKey = PluralBaseOf<TranslationKey>;
