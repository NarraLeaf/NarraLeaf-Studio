import { useMemo, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import type {
    StoryClipReveal,
    StoryDisplayableTargetKind,
    StoryFilterFunction,
    StoryTransformProps,
    StoryTransformRef,
} from "@shared/types/story";
import { legacyPresetPosition } from "@shared/story/transformLegacy";
import type { TranslationKey } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { Select, Slider, type SelectOption } from "@/lib/components/elements";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { placementWordFor } from "./commands/transitions";
import { AssetField } from "./AssetField";
import { type TFunc } from "./inspectorFieldKit";
import {
    addableTransformChannels,
    cameraLookCss,
    filterRecordOf,
    LOOK_INTENSITY_MAX,
    LOOK_INTENSITY_STEP,
    readCameraLookCss,
    roundLookIntensity,
    statedTransformChannels,
    TRANSFORM_CHANNEL_GROUPS,
    transformChannelById,
    withFilterFunction,
    withTransformProps,
    type TransformChannelSpec,
} from "./transformChannels";
import { STORY_CAMERA_LOOK_PRESETS } from "@/lib/ui-editor/runtime/game/cameraLookPresets";

/**
 * The stated channels of a transform, one row each, plus the picker that adds another.
 *
 * The list IS the row: what is drawn here is exactly what the bag holds, in the order the vocabulary
 * lists it, and every entry can be taken back out. That is the whole change from the surface this
 * replaces, which asked the author to pick one effect and then hid every other channel the same row
 * could state.
 *
 * Removing a row deletes the channel rather than neutralising it - the same instruction
 * `/reset hero mask` writes, and not the same thing as setting the mask to nothing.
 */

const CHANNEL_LABEL_CLASS = "w-16 shrink-0 truncate text-2xs text-fg-muted";

/**
 * The CSS `mix-blend-mode` keywords, as CSS spells them.
 *
 * Untranslated on purpose, and the same list the command line offers: a blend mode is a property of
 * the material an author prepared in another tool, so the word here has to be the word there.
 */
const BLEND_MODES: readonly string[] = [
    "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
    "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

const REVEAL_KINDS: readonly StoryClipReveal["kind"][] = ["circleReveal", "circleClose", "wipe"];

const WIPE_DIRECTIONS: readonly NonNullable<StoryClipReveal["direction"]>[] = ["left", "right", "top", "bottom"];

/** `left` / `center` / `right`, or the free pair the author typed as `x,y`. */
const PLACEMENT_WORDS = ["left", "center", "right"] as const;

function ChannelRow(props: { label: string; removeLabel: string; onRemove: () => void; children: ReactNode; below?: ReactNode }) {
    return (
        <div className="border-b border-edge/60 py-1 last:border-b-0">
            <div className="flex items-center gap-2">
                <span className={CHANNEL_LABEL_CLASS}>{props.label}</span>
                <div className="min-w-0 flex-1">{props.children}</div>
                <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-fill hover:text-fg"
                    aria-label={props.removeLabel}
                    data-tip={props.removeLabel}
                    onClick={props.onRemove}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            {props.below ? (
                // A second line under the control, indented by an empty copy of the label column so
                // it lines up with the control above without a hand-measured padding.
                <div className="mt-1 flex items-center gap-2">
                    <span className={CHANNEL_LABEL_CLASS} aria-hidden="true" />
                    <div className="min-w-0 flex-1">{props.below}</div>
                </div>
            ) : null}
        </div>
    );
}

const DENSE_INPUT_CLASS = "h-7 min-h-7 text-xs";

function ChannelNumber(props: { value: number | undefined; onChange: (value: number) => void; fallback: number }) {
    return (
        <NumericDraftEnhancedInput
            committedDisplay={props.value === undefined ? "" : String(props.value)}
            onFiniteNumber={props.onChange}
            onEmpty={() => props.onChange(props.fallback)}
            type="text"
            inputMode="decimal"
            popoverWhenNarrow={false}
            className={DENSE_INPUT_CLASS}
            inputClassName="px-1.5"
        />
    );
}

function ChannelText(props: { value: string; onChange: (value: string) => void; placeholder?: string }) {
    return (
        <EnhancedInput
            value={props.value}
            placeholder={props.placeholder}
            onChange={props.onChange}
            className={DENSE_INPUT_CLASS}
        />
    );
}

function ChannelSelect(props: { label: string; options: SelectOption[]; value: string; onChange: (value: string) => void }) {
    return (
        <Select
            fullWidth
            portalMenu
            size="sm"
            ariaLabel={props.label}
            options={props.options}
            value={props.value}
            onChange={value => props.onChange(String(value))}
        />
    );
}

/** Milliseconds on the document, seconds in the control - the split every timing field here makes. */
function ChannelSeconds(props: { value: number | undefined; onChange: (ms: number) => void }) {
    return (
        <ChannelNumber
            value={props.value === undefined ? undefined : props.value / 1000}
            onChange={seconds => props.onChange(Math.round(seconds * 1000))}
            fallback={0}
        />
    );
}

function PositionControl(props: { value: StoryTransformProps["position"]; onChange: (position: NonNullable<StoryTransformProps["position"]>) => void; t: TFunc }) {
    const word = placementWordFor(props.value);
    const options: SelectOption[] = [
        ...PLACEMENT_WORDS.map(entry => ({ value: entry, label: props.t(`storyInspector.transformPreset.${entry}` as TranslationKey) })),
        { value: "custom", label: props.t("storyInspector.transformPreset.custom") },
    ];
    return (
        <ChannelSelect
            label={props.t("story.paramHint.placement")}
            options={options}
            value={word ?? "custom"}
            onChange={next => {
                if (next === "custom") {
                    props.onChange({ xalign: props.value?.xalign ?? 0.5, yalign: props.value?.yalign ?? 0.5 });
                    return;
                }
                props.onChange(legacyPresetPosition(next, {}) ?? { xalign: 0.5, yalign: 0.5 });
            }}
        />
    );
}

function PositionAxes(props: { value: StoryTransformProps["position"]; onChange: (position: NonNullable<StoryTransformProps["position"]>) => void; t: TFunc }) {
    const axis = (key: "xalign" | "yalign") => (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-2xs text-fg-subtle">{props.t(key === "xalign" ? "storyInspector.transformChannel.xAlign" : "storyInspector.transformChannel.yAlign")}</span>
            <ChannelNumber
                value={props.value?.[key]}
                onChange={next => props.onChange({ ...(props.value ?? {}), [key]: next })}
                fallback={0.5}
            />
        </div>
    );
    return <div className="flex items-center gap-2">{axis("xalign")}{axis("yalign")}</div>;
}

function LookControl(props: { css: string; onChange: (css: string) => void; t: TFunc }) {
    const reading = readCameraLookCss(props.css);
    const preset = reading?.preset ?? STORY_CAMERA_LOOK_PRESETS[0]?.id ?? "";
    const intensity = reading?.intensity ?? 1;
    const options: SelectOption[] = STORY_CAMERA_LOOK_PRESETS.map(entry => ({
        value: entry.id,
        label: props.t(`storyInspector.cameraLook.${entry.id}` as TranslationKey),
    }));
    return (
        <ChannelSelect
            label={props.t("story.paramHint.cameraLook")}
            options={options}
            value={preset}
            onChange={next => props.onChange(cameraLookCss(next, intensity))}
        />
    );
}

/**
 * The grade's strength, on the grid the reverse index was built over.
 *
 * The slider steps by exactly {@link LOOK_INTENSITY_STEP} and the value is rounded before it becomes
 * CSS, which is what keeps the name readable: the row stores only the expanded chain, so a strength
 * the index has no entry for would re-open as a hand-written filter.
 */
function LookIntensity(props: { css: string; onChange: (css: string) => void; t: TFunc }) {
    const reading = readCameraLookCss(props.css);
    if (!reading) {
        return null;
    }
    return (
        <div className="flex items-center gap-2">
            <span className="shrink-0 text-2xs text-fg-subtle">{props.t("story.paramHint.cameraLookStrength")}</span>
            <Slider
                className="min-w-0 flex-1"
                min={LOOK_INTENSITY_STEP}
                max={LOOK_INTENSITY_MAX}
                step={LOOK_INTENSITY_STEP}
                value={reading.intensity}
                onValueChange={next => props.onChange(cameraLookCss(reading.preset, roundLookIntensity(next)))}
            />
            <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">{reading.intensity.toFixed(2)}</span>
        </div>
    );
}

function RevealDetail(props: { value: StoryClipReveal; onChange: (value: StoryClipReveal) => void; t: TFunc }) {
    if (props.value.kind === "wipe") {
        return (
            <ChannelSelect
                label={props.t("storyInspector.field.direction")}
                options={WIPE_DIRECTIONS.map(entry => ({ value: entry, label: props.t(`storyInspector.wipeDirection.${entry}` as TranslationKey) }))}
                value={props.value.direction ?? "left"}
                onChange={direction => props.onChange({ ...props.value, direction: direction as StoryClipReveal["direction"] })}
            />
        );
    }
    return (
        <div className="flex items-center gap-2">
            <ChannelText
                value={props.value.center ?? ""}
                placeholder="50% 50%"
                onChange={center => props.onChange({ ...props.value, center: center || undefined })}
            />
            <ChannelNumber
                value={props.value.fromRadius}
                onChange={fromRadius => props.onChange({ ...props.value, fromRadius })}
                fallback={0}
            />
            <ChannelNumber
                value={props.value.toRadius}
                onChange={toRadius => props.onChange({ ...props.value, toRadius })}
                fallback={0}
            />
        </div>
    );
}

/** The control and the optional second line a channel draws, given the ref it is stated on. */
function channelBody(
    channel: TransformChannelSpec,
    ref: StoryTransformRef,
    patch: (next: StoryTransformRef) => void,
    t: TFunc,
): { control: ReactNode; below?: ReactNode } {
    const to = ref.to ?? {};
    const label = channel.label(t);
    const setProps = (props: Partial<StoryTransformProps>) => patch(withTransformProps(ref, props));

    if (channel.id.startsWith("clear.")) {
        // A restored channel has no value to edit - the row exists to say the channel is being put
        // back, and to be taken off again.
        return { control: <span className="text-xs text-fg-subtle">{t("storyInspector.transformChannel.restored")}</span> };
    }
    if (channel.id === "position") {
        return {
            control: <PositionControl value={to.position} t={t} onChange={position => setProps({ position })} />,
            below: placementWordFor(to.position)
                ? undefined
                : <PositionAxes value={to.position} t={t} onChange={position => setProps({ position })} />,
        };
    }
    if (channel.id === "zoom" || channel.id === "scaleX" || channel.id === "scaleY" || channel.id === "rotation" || channel.id === "opacity") {
        const key = channel.id;
        return {
            control: <ChannelNumber value={to[key]} onChange={value => setProps({ [key]: value })} fallback={key === "rotation" ? 0 : 1} />,
        };
    }
    if (channel.id.startsWith("filter.")) {
        const fn = channel.id.slice("filter.".length) as StoryFilterFunction;
        return {
            control: (
                <ChannelNumber
                    value={filterRecordOf(ref)?.[fn]}
                    onChange={value => patch(withFilterFunction(ref, fn, value))}
                    fallback={0}
                />
            ),
        };
    }
    if (channel.id === "look") {
        const css = to.filterRaw ?? "";
        const onChange = (next: string) => setProps({ filterRaw: next });
        return {
            control: <LookControl css={css} t={t} onChange={onChange} />,
            below: <LookIntensity css={css} t={t} onChange={onChange} />,
        };
    }
    if (channel.id === "filterRaw") {
        return {
            control: <ChannelText value={to.filterRaw ?? ""} placeholder="blur(4px) grayscale(1)" onChange={filterRaw => setProps({ filterRaw })} />,
        };
    }
    if (channel.id === "mask") {
        return {
            control: (
                <AssetField
                    compact
                    assetType={AssetType.Image}
                    assetId={to.maskAssetId ?? undefined}
                    onChange={maskAssetId => setProps({ maskAssetId: maskAssetId ?? "" })}
                />
            ),
        };
    }
    if (channel.id === "clip") {
        return { control: <ChannelText value={to.clipPath ?? ""} placeholder="circle(40%)" onChange={clipPath => setProps({ clipPath })} /> };
    }
    if (channel.id === "backdrop") {
        return { control: <ChannelText value={to.backdropFilter ?? ""} placeholder="blur(8px)" onChange={backdropFilter => setProps({ backdropFilter })} /> };
    }
    if (channel.id === "blend") {
        return {
            control: (
                <ChannelSelect
                    label={label}
                    options={BLEND_MODES.map(mode => ({ value: mode, label: mode }))}
                    value={to.mixBlendMode ?? "normal"}
                    onChange={mixBlendMode => setProps({ mixBlendMode })}
                />
            ),
        };
    }
    if (channel.id === "reveal") {
        const reveal = ref.clipReveal ?? { kind: "circleReveal" as const };
        const setReveal = (next: StoryClipReveal) => patch({ ...ref, mode: "props", clipReveal: next });
        return {
            control: (
                <ChannelSelect
                    label={label}
                    options={REVEAL_KINDS.map(kind => ({ value: kind, label: t(`storyInspector.displayableOperation.${kind}` as TranslationKey) }))}
                    value={reveal.kind}
                    onChange={kind => setReveal({ ...reveal, kind: kind as StoryClipReveal["kind"] })}
                />
            ),
            below: <RevealDetail value={reveal} t={t} onChange={setReveal} />,
        };
    }
    if (channel.id === "fontColor") {
        const value = to.fontColor ?? "#ffffff";
        const parsed = parseColorValue(value, { hex: "#ffffff", alpha: 1 });
        return {
            control: (
                <div className="flex items-center gap-2">
                    <ColorPickerTrigger
                        value={{ hex: parsed.hex, alpha: 1 }}
                        displayMode="icon"
                        allowOpacity={false}
                        onChange={next => setProps({ fontColor: colorValueToCss({ hex: next.hex, alpha: 1 }) })}
                    />
                    <ChannelText value={value} onChange={fontColor => setProps({ fontColor })} />
                </div>
            ),
        };
    }
    if (channel.id === "repeat") {
        return { control: <ChannelNumber value={ref.repeat} onChange={repeat => patch({ ...ref, mode: "props", repeat })} fallback={1} /> };
    }
    if (channel.id === "delayMs" || channel.id === "repeatDelayMs") {
        const key = channel.id;
        return { control: <ChannelSeconds value={ref[key]} onChange={ms => patch({ ...ref, mode: "props", [key]: ms })} /> };
    }
    return { control: null };
}

function AddChannelPicker(props: {
    channels: readonly TransformChannelSpec[];
    onAdd: (channel: TransformChannelSpec) => void;
    t: TFunc;
}) {
    const [open, setOpen] = useState(false);
    const grouped = useMemo(() => TRANSFORM_CHANNEL_GROUPS
        .map(group => ({ group, entries: props.channels.filter(channel => channel.group === group) }))
        .filter(entry => entry.entries.length > 0), [props.channels]);

    if (grouped.length === 0) {
        return null;
    }
    return (
        <div className="mt-2">
            <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                aria-expanded={open}
                onClick={() => setOpen(current => !current)}
            >
                <Plus className="h-3 w-3" />
                {props.t("storyInspector.transformChannel.add")}
            </button>
            {open ? (
                <div className="mt-1.5 rounded-md border border-edge bg-surface-raised p-2">
                    {grouped.map(({ group, entries }) => (
                        <div key={group} className="mb-2 last:mb-0">
                            <div className="mb-1 text-2xs text-fg-subtle">
                                {props.t(`storyInspector.transformChannelGroup.${group}` as TranslationKey)}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {entries.map(channel => (
                                    <button
                                        key={channel.id}
                                        type="button"
                                        className="rounded-md border border-edge px-1.5 py-0.5 text-2xs text-fg-muted transition-colors hover:border-primary/40 hover:bg-fill hover:text-fg"
                                        onClick={() => {
                                            props.onAdd(channel);
                                            setOpen(false);
                                        }}
                                    >
                                        {channel.label(props.t)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function TransformChannelEditor(props: {
    value: StoryTransformRef | undefined;
    targetKind: StoryDisplayableTargetKind;
    onChange: (value: StoryTransformRef) => void;
}) {
    const { t } = useTranslation();
    const ref: StoryTransformRef = props.value ?? { mode: "props" };
    const stated = statedTransformChannels(ref);
    const addable = addableTransformChannels(ref, { isText: props.targetKind === "text" });
    const removeLabel = t("storyInspector.transformChannel.remove");

    return (
        <div className="grid grid-cols-1 gap-0">
            {stated.map(channel => {
                const body = channelBody(channel, ref, props.onChange, t);
                return (
                    <ChannelRow
                        key={channel.id}
                        label={channel.label(t)}
                        removeLabel={removeLabel}
                        onRemove={() => props.onChange(transformChannelById(channel.id)?.remove(ref) ?? ref)}
                        below={body.below}
                    >
                        {body.control}
                    </ChannelRow>
                );
            })}
            <AddChannelPicker channels={addable} t={t} onAdd={channel => props.onChange(channel.add(ref))} />
        </div>
    );
}
