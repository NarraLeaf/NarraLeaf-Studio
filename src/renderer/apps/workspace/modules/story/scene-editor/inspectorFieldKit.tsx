import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { isStoryBezierEasing, STORY_DEFAULT_BEZIER_EASING } from "@shared/utils/storyEasing";
import type { Translator } from "@shared/i18n";
import { Select, type SelectOption } from "@/lib/components/elements";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { EasingCurveEditor } from "../../../components/ui/EasingCurveEditor";

/**
 * The action inspector's shared field primitives.
 *
 * Extracted from `StorySceneActionInspector.tsx` when the camera editor moved into its own file: two
 * files rendering property sections must use the same `Section` and the same `SecondsField`, or the
 * inspector grows a second visual dialect one action at a time.
 */

export const FIELD_LABEL_CLASS = "block text-xs font-medium text-fg-muted mb-1";

export type TFunc = Translator["t"];

/**
 * The easing word list, plus the option that stands for a drawn curve.
 *
 * Not exported: {@link EasingField} is the only thing that renders it, so a new action cannot pair
 * this list with a plain select and end up offering the custom option with no card to draw it in.
 */
const easingOptions = (t: TFunc): SelectOption[] => [
    { value: "", label: t("storyInspector.easing.default") },
    { value: "linear", label: t("storyInspector.easing.linear") },
    { value: "easeIn", label: t("storyInspector.easing.easeIn") },
    { value: "easeOut", label: t("storyInspector.easing.easeOut") },
    { value: "easeInOut", label: t("storyInspector.easing.easeInOut") },
    { value: "circIn", label: t("storyInspector.easing.circIn") },
    { value: "circOut", label: t("storyInspector.easing.circOut") },
    { value: "circInOut", label: t("storyInspector.easing.circInOut") },
    { value: "backIn", label: t("storyInspector.easing.backIn") },
    { value: "backOut", label: t("storyInspector.easing.backOut") },
    { value: "backInOut", label: t("storyInspector.easing.backInOut") },
    { value: "anticipate", label: t("storyInspector.easing.anticipate") },
    { value: CUSTOM_EASING_OPTION, label: t("storyInspector.easing.custom") },
];

/**
 * The option that stands for a curve rather than a word.
 *
 * Not a stored value: picking it writes a `cubic-bezier(…)` into the same field the named easings
 * use, and a stored curve reads back as this option. The field carries one string either way, which
 * is why nothing downstream - the compiler, the command line, the document - grew a second shape.
 */
export const CUSTOM_EASING_OPTION = "__custom";

/**
 * The `Easing` field, whole: the pick, plus the curve card when the pick is a drawn one.
 *
 * Every action that eases anything shows this one field, so it owns the whole choice rather than
 * leaving each caller to pair a select with a card. The card sits under the select inside the same
 * grid cell, which is what makes it read as belonging to this field rather than as a new section.
 */
export function EasingField(props: { t: TFunc; value: string | undefined; onChange: (easing: string | undefined) => void }) {
    const custom = isStoryBezierEasing(props.value);
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.t("storyInspector.field.easing")}</label>
            <Select
                fullWidth
                portalMenu
                options={easingOptions(props.t)}
                value={custom ? CUSTOM_EASING_OPTION : (props.value ?? "")}
                onChange={next => props.onChange(nextEasingValue(String(next), props.value))}
            />
            {custom ? (
                <div className="mt-1.5">
                    <EasingCurveEditor easing={props.value ?? STORY_DEFAULT_BEZIER_EASING} onChange={props.onChange} />
                </div>
            ) : null}
        </div>
    );
}

/**
 * What the picked option stores. Asking for a custom curve keeps the curve already there, so
 * switching to a named easing and back does not throw away the shape the author drew.
 */
export function nextEasingValue(picked: string, current: string | undefined): string | undefined {
    if (picked !== CUSTOM_EASING_OPTION) {
        return picked || undefined;
    }
    return isStoryBezierEasing(current) ? current : STORY_DEFAULT_BEZIER_EASING;
}

/**
 * A titled, boxed group used to organise the compact action editor into scannable
 * sections (Basics / Appearance / Motion / Transition / Timing / ...).
 */
export function Section(props: { title?: string; right?: ReactNode; className?: string; children: ReactNode }) {
    return (
        <section className={["rounded-lg border border-edge bg-fill-subtle p-2.5", props.className ?? ""].join(" ")}>
            {props.title || props.right ? (
                <div className="mb-2 flex items-center justify-between gap-2">
                    {props.title ? (
                        <div className="min-w-0 truncate text-2xs font-medium tracking-wide text-fg-muted">{props.title}</div>
                    ) : <span />}
                    {props.right ? <div className="shrink-0">{props.right}</div> : null}
                </div>
            ) : null}
            {props.children}
        </section>
    );
}

/** Collapsible disclosure using the project chevron (matches the story panel accordion). */
export function Disclosure(props: { title: string; children: ReactNode }) {
    return (
        <details className="group">
            <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-2xs font-medium tracking-wide text-fg-subtle transition-colors hover:text-fg-muted [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                {props.title}
            </summary>
            <div className="mt-2">{props.children}</div>
        </details>
    );
}

/**
 * Standard dense field grid used across every action editor. Columns respond to
 * the property card's own width (see `.nl-field-grid` in styles.css), so a narrow
 * editor pane collapses to fewer columns instead of overflowing horizontally.
 */
export function FieldGrid(props: { cols?: 2 | 3 | 4; className?: string; children: ReactNode }) {
    const cols = props.cols ?? 3;
    const colClass = cols === 2 ? "nl-field-grid-2" : cols === 4 ? "nl-field-grid-4" : "";
    return <div className={["nl-field-grid", colClass, props.className ?? ""].join(" ")}>{props.children}</div>;
}

/** Compact inline segmented toggle (e.g. Preset / Motion). */
export function SegToggle<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
    return (
        <div className="inline-flex overflow-hidden rounded-md border border-edge bg-surface">
            {props.options.map((option, index) => (
                <button
                    key={option.value}
                    type="button"
                    className={[
                        "h-7 px-2.5 text-xs transition-colors",
                        index > 0 ? "border-l border-edge" : "",
                        props.value === option.value ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                    ].join(" ")}
                    onClick={() => props.onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

export function SelectField(props: { label: string; options: SelectOption[]; value: string | number; onChange: (value: string | number) => void }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <Select
                fullWidth
                portalMenu
                options={props.options}
                value={props.value}
                onChange={props.onChange}
            />
        </div>
    );
}

export function NumberField(props: { label: string; value: number | undefined; onChange: (value: number | undefined) => void }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <NumericDraftEnhancedInput
                committedDisplay={props.value === undefined ? "" : String(props.value)}
                onFiniteNumber={props.onChange}
                onEmpty={() => props.onChange(undefined)}
                type="text"
                inputMode="decimal"
            />
        </div>
    );
}

/**
 * A free-typed string, or a pick when `options` is given.
 *
 * Moved here from `StorySceneActionInspector` when the camera editor grew a raw-CSS escape hatch: it
 * was the third file that needed a plain text row, and the kit exists precisely so the second one
 * does not draw its own.
 */
export function TextField(props: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options?: SelectOption[];
    /** Shown when `value` is empty — used for a derived default, which is not authored content. */
    placeholder?: string;
}) {
    if (props.options) {
        return (
            <SelectField
                label={props.label}
                options={props.options}
                value={props.value}
                onChange={value => props.onChange(String(value))}
            />
        );
    }
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <EnhancedInput
                value={props.value}
                placeholder={props.placeholder}
                onChange={props.onChange}
            />
        </div>
    );
}

/**
 * Edits a millisecond-backed timing field in seconds. `value` and `onChange` both speak the
 * stored milliseconds; only the text the author reads and types is seconds.
 */
export function SecondsField(props: { label: string; value: number | undefined; onChange: (ms: number | undefined) => void }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <NumericDraftEnhancedInput
                committedDisplay={formatStorySecondsValue(props.value)}
                onFiniteNumber={seconds => props.onChange(storySecondsToMs(seconds))}
                onEmpty={() => props.onChange(undefined)}
                type="text"
                inputMode="decimal"
            />
        </div>
    );
}
