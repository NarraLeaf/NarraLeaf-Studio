import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import type { Translator } from "@shared/i18n";
import { Select, type SelectOption } from "@/lib/components/elements";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";

/**
 * The action inspector's shared field primitives.
 *
 * Extracted from `StorySceneActionInspector.tsx` when the camera editor moved into its own file: two
 * files rendering property sections must use the same `Section` and the same `SecondsField`, or the
 * inspector grows a second visual dialect one action at a time.
 */

export const FIELD_LABEL_CLASS = "block text-xs font-medium text-fg-muted mb-1";
export const SELECT_CLASS = "[&>button]:h-9 [&>button]:min-h-[34px] [&>button]:py-0";

export type TFunc = Translator["t"];

export const easingOptions = (t: TFunc): SelectOption[] => [
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
];

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
                className={SELECT_CLASS}
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
