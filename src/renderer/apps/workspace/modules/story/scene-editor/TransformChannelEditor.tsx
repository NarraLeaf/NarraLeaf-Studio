import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { cn } from "@/lib/utils/cn";
import {
    AnchoredPanel,
    CONTROL_HEIGHT_CLASS,
    FieldLabel,
    IconButton,
    SearchInput,
    Select,
    Slider,
    type PanelAnchor,
    type SelectOption,
} from "@/lib/components/elements";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { placementWordFor } from "./commands/transitions";
import { AssetField } from "./AssetField";
import { TransformChannelPreview } from "./TransformChannelPreview";
import { Disclosure, type TFunc } from "./inspectorFieldKit";
import {
    addableTransformChannels,
    filterRecordOf,
    formatBackdropBlur,
    formatStoryClipShape,
    LOOK_INTENSITY_MAX,
    LOOK_INTENSITY_STEP,
    parseBackdropBlur,
    parseStoryClipShape,
    roundLookIntensity,
    seedStoryClipShape,
    statedTransformChannels,
    TRANSFORM_CHANNEL_GROUPS,
    transformChannelById,
    withFilterFunction,
    withTransformProps,
    type StoryClipShape,
    type TransformChannelSpec,
} from "./transformChannels";
import { STORY_CAMERA_LOOK_PRESETS } from "@/lib/ui-editor/runtime/game/cameraLookPresets";

/**
 * The stated channels of a transform, one row each, plus the picker that adds another.
 *
 * The list IS the row: what is drawn here is exactly what the bag holds, in the order the vocabulary
 * lists it, and every entry can be taken back out. Removing a row deletes the channel rather than
 * neutralising it - the instruction `/reset hero mask` writes, and not the same thing as a mask set
 * to nothing.
 *
 * **Rows are spaced, not ruled.** The properties panel separates fields with space; a hairline per
 * row turned a five-channel transform into a table, which is not what the rest of the inspector
 * looks like. Every control sits on the `sm` step of the shared scale (`docs/design-system.md` §3),
 * so the list lines up with the fields above it instead of setting its own height.
 */

/** The label column. `FieldLabel` is the sanctioned eyebrow; this only moves it beside the control. */
const CHANNEL_LABEL_CLASS = "mb-0 w-20 shrink-0 truncate leading-7";

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
const PLACEMENT_WORDS = ["left", "center", "right"] as const;
const CLIP_SHAPE_KINDS: readonly StoryClipShape["kind"][] = ["inset", "circle", "ellipse", "raw"];

/** The four CSS mask settings, as the keyword sets they actually take. */
const MASK_SETTINGS = [
    { key: "maskSize", labelKey: "storyInspector.transformChannel.maskSize", options: ["contain", "cover", "auto", "100% 100%"] },
    { key: "maskPosition", labelKey: "storyInspector.transformChannel.maskPosition", options: ["center", "top", "bottom", "left", "right"] },
    { key: "maskRepeat", labelKey: "storyInspector.transformChannel.maskRepeat", options: ["no-repeat", "repeat", "repeat-x", "repeat-y"] },
    { key: "maskMode", labelKey: "storyInspector.transformChannel.maskMode", options: ["alpha", "luminance"] },
] as const;

// ---------------------------------------------------------------------------------------------
// Row primitives
// ---------------------------------------------------------------------------------------------

function ChannelRow(props: { label: string; removeLabel: string; onRemove: () => void; children: ReactNode; below?: ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-2">
                <FieldLabel as="span" className={CHANNEL_LABEL_CLASS}>{props.label}</FieldLabel>
                <div className="min-w-0 flex-1">{props.children}</div>
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={props.removeLabel}
                    data-tip={props.removeLabel}
                    onClick={props.onRemove}
                >
                    <X className="h-3.5 w-3.5" />
                </IconButton>
            </div>
            {props.below ? (
                // A second line, indented by an empty copy of the label column so it lines up with
                // the control above rather than with a measured padding.
                <div className="mt-1 flex items-start gap-2">
                    <span className={cn(CHANNEL_LABEL_CLASS, "block")} aria-hidden="true" />
                    <div className="min-w-0 flex-1 pr-7">{props.below}</div>
                </div>
            ) : null}
        </div>
    );
}

function ChannelNumber(props: { value: number | undefined; onChange: (value: number) => void; fallback: number; label?: string }) {
    return (
        <NumericDraftEnhancedInput
            committedDisplay={props.value === undefined ? "" : String(props.value)}
            onFiniteNumber={props.onChange}
            onEmpty={() => props.onChange(props.fallback)}
            type="text"
            inputMode="decimal"
            aria-label={props.label}
            popoverWhenNarrow={false}
            className={cn(CONTROL_HEIGHT_CLASS.sm, "text-xs")}
            inputClassName="px-2"
        />
    );
}

function ChannelText(props: { value: string; onChange: (value: string) => void; placeholder?: string }) {
    return (
        <EnhancedInput
            value={props.value}
            placeholder={props.placeholder}
            onChange={props.onChange}
            className={cn(CONTROL_HEIGHT_CLASS.sm, "text-xs")}
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
function ChannelSeconds(props: { value: number | undefined; onChange: (ms: number) => void; label: string }) {
    return (
        <ChannelNumber
            label={props.label}
            value={props.value === undefined ? undefined : props.value / 1000}
            onChange={seconds => props.onChange(Math.round(seconds * 1000))}
            fallback={0}
        />
    );
}

/** A labelled number sharing a line with its siblings - the shape every multi-value channel uses. */
function AxisNumber(props: { label: string; value: number | undefined; fallback: number; onChange: (value: number) => void }) {
    return (
        <label className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-2xs text-fg-subtle">{props.label}</span>
            <ChannelNumber label={props.label} value={props.value} onChange={props.onChange} fallback={props.fallback} />
        </label>
    );
}

// ---------------------------------------------------------------------------------------------
// The channels that used to be a CSS text box
// ---------------------------------------------------------------------------------------------

function ClipShapeControl(props: { value: string; onChange: (css: string) => void; t: TFunc }) {
    const shape = parseStoryClipShape(props.value);
    const set = (next: StoryClipShape) => props.onChange(formatStoryClipShape(next));
    return (
        <ChannelSelect
            label={props.t("story.paramHint.clipPath")}
            options={CLIP_SHAPE_KINDS.map(kind => ({
                value: kind,
                label: props.t(`storyInspector.transformChannel.clipShape.${kind}` as TranslationKey),
            }))}
            value={shape.kind}
            onChange={kind => set(seedStoryClipShape(kind as StoryClipShape["kind"], shape))}
        />
    );
}

function ClipShapeParams(props: { value: string; onChange: (css: string) => void; t: TFunc }) {
    const shape = parseStoryClipShape(props.value);
    const set = (next: StoryClipShape) => props.onChange(formatStoryClipShape(next));
    const pct = (key: string) => props.t(`storyInspector.transformChannel.clipParam.${key}` as TranslationKey);

    if (shape.kind === "raw") {
        return <ChannelText value={shape.value} placeholder="polygon(50% 0%, 100% 100%, 0% 100%)" onChange={value => set({ kind: "raw", value })} />;
    }
    if (shape.kind === "inset") {
        return (
            <div className="grid grid-cols-2 gap-1.5">
                <AxisNumber label={pct("top")} value={shape.top} fallback={0} onChange={top => set({ ...shape, top })} />
                <AxisNumber label={pct("right")} value={shape.right} fallback={0} onChange={right => set({ ...shape, right })} />
                <AxisNumber label={pct("bottom")} value={shape.bottom} fallback={0} onChange={bottom => set({ ...shape, bottom })} />
                <AxisNumber label={pct("left")} value={shape.left} fallback={0} onChange={left => set({ ...shape, left })} />
            </div>
        );
    }
    if (shape.kind === "circle") {
        return (
            <div className="grid grid-cols-2 gap-1.5">
                <AxisNumber label={pct("radius")} value={shape.radius} fallback={50} onChange={radius => set({ ...shape, radius })} />
                <span />
                <AxisNumber label={pct("x")} value={shape.x} fallback={50} onChange={x => set({ ...shape, x })} />
                <AxisNumber label={pct("y")} value={shape.y} fallback={50} onChange={y => set({ ...shape, y })} />
            </div>
        );
    }
    return (
        <div className="grid grid-cols-2 gap-1.5">
            <AxisNumber label={pct("radiusX")} value={shape.radiusX} fallback={50} onChange={radiusX => set({ ...shape, radiusX })} />
            <AxisNumber label={pct("radiusY")} value={shape.radiusY} fallback={35} onChange={radiusY => set({ ...shape, radiusY })} />
            <AxisNumber label={pct("x")} value={shape.x} fallback={50} onChange={x => set({ ...shape, x })} />
            <AxisNumber label={pct("y")} value={shape.y} fallback={50} onChange={y => set({ ...shape, y })} />
        </div>
    );
}

/**
 * The backdrop, as a blur radius whenever that is all it is.
 *
 * Frosted glass is very nearly the only thing this channel is asked for, and it is one number. A
 * chain that is anything else keeps the text box, so nothing written by hand becomes unreachable.
 */
function BackdropControl(props: { value: string; onChange: (css: string) => void; t: TFunc }) {
    const blur = parseBackdropBlur(props.value);
    if (blur === null && props.value.trim()) {
        return <ChannelText value={props.value} placeholder="blur(8px)" onChange={props.onChange} />;
    }
    return (
        <div className="flex items-center gap-2">
            <Slider
                className="min-w-0 flex-1"
                min={0}
                max={24}
                step={0.5}
                value={blur ?? 0}
                onValueChange={next => props.onChange(formatBackdropBlur(next))}
            />
            <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">{(blur ?? 0).toFixed(1)}</span>
        </div>
    );
}

function MaskSettings(props: { to: StoryTransformProps; onChange: (patch: Partial<StoryTransformProps>) => void; t: TFunc }) {
    return (
        <Disclosure title={props.t("storyInspector.transformChannel.maskSettings")}>
            <div className="grid grid-cols-1 gap-1.5">
                {MASK_SETTINGS.map(setting => {
                    const label = props.t(setting.labelKey);
                    const current = props.to[setting.key];
                    return (
                        <div key={setting.key} className="flex items-center gap-2">
                            <FieldLabel as="span" className="mb-0 w-16 shrink-0 truncate leading-7">{label}</FieldLabel>
                            <div className="min-w-0 flex-1">
                                <ChannelSelect
                                    label={label}
                                    options={[
                                        { value: "", label: props.t("storyInspector.transformChannel.inherit") },
                                        ...setting.options.map(option => ({ value: option, label: option })),
                                    ]}
                                    value={typeof current === "string" ? current : ""}
                                    onChange={value => props.onChange({ [setting.key]: value || undefined })}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </Disclosure>
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

function LookIntensity(props: { value: number; onChange: (intensity: number) => void; t: TFunc }) {
    return (
        <div className="flex items-center gap-2">
            <span className="shrink-0 text-2xs text-fg-subtle">{props.t("story.paramHint.cameraLookStrength")}</span>
            <Slider
                className="min-w-0 flex-1"
                min={LOOK_INTENSITY_STEP}
                max={LOOK_INTENSITY_MAX}
                step={LOOK_INTENSITY_STEP}
                value={props.value}
                onValueChange={next => props.onChange(roundLookIntensity(next))}
            />
            <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fg-subtle">{props.value.toFixed(2)}</span>
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
        <div className="flex items-center gap-1.5">
            <AxisNumber
                label={props.t("storyInspector.field.fromRadius")}
                value={props.value.fromRadius}
                fallback={0}
                onChange={fromRadius => props.onChange({ ...props.value, fromRadius })}
            />
            <AxisNumber
                label={props.t("storyInspector.field.toRadius")}
                value={props.value.toRadius}
                fallback={100}
                onChange={toRadius => props.onChange({ ...props.value, toRadius })}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------------------------
// Row bodies
// ---------------------------------------------------------------------------------------------

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
        return { control: <span className="text-xs leading-7 text-fg-subtle">{t("storyInspector.transformChannel.restored")}</span> };
    }
    if (channel.id === "position") {
        return {
            control: <PositionControl value={to.position} t={t} onChange={position => setProps({ position })} />,
            below: placementWordFor(to.position) ? undefined : (
                <div className="flex items-center gap-1.5">
                    <AxisNumber
                        label={t("storyInspector.transformChannel.xAlign")}
                        value={to.position?.xalign}
                        fallback={0.5}
                        onChange={xalign => setProps({ position: { ...(to.position ?? {}), xalign } })}
                    />
                    <AxisNumber
                        label={t("storyInspector.transformChannel.yAlign")}
                        value={to.position?.yalign}
                        fallback={0.5}
                        onChange={yalign => setProps({ position: { ...(to.position ?? {}), yalign } })}
                    />
                </div>
            ),
        };
    }
    if (channel.id === "zoom" || channel.id === "scaleX" || channel.id === "scaleY" || channel.id === "rotation" || channel.id === "opacity") {
        const key = channel.id;
        return {
            control: <ChannelNumber label={label} value={to[key]} onChange={value => setProps({ [key]: value })} fallback={key === "rotation" ? 0 : 1} />,
        };
    }
    if (channel.id.startsWith("filter.")) {
        const fn = channel.id.slice("filter.".length) as StoryFilterFunction;
        return {
            control: <ChannelNumber label={label} value={filterRecordOf(ref)?.[fn]} onChange={value => patch(withFilterFunction(ref, fn, value))} fallback={0} />,
        };
    }
    if (channel.id === "look") {
        // The NAME, not the chain it expands to. The row stores the author's choice, so the picker
        // opens on it directly instead of matching an expanded filter string back to a preset.
        const look = to.look ?? null;
        const intensity = look?.intensity ?? 1;
        return {
            control: (
                <ChannelSelect
                    label={label}
                    options={STORY_CAMERA_LOOK_PRESETS.map(entry => ({
                        value: entry.id,
                        label: t(`storyInspector.cameraLook.${entry.id}` as TranslationKey),
                    }))}
                    value={look?.preset ?? STORY_CAMERA_LOOK_PRESETS[0]?.id ?? ""}
                    onChange={next => setProps({ look: { preset: next, intensity } })}
                />
            ),
            below: (
                <>
                    <LookIntensity
                        value={intensity}
                        t={t}
                        onChange={next => setProps({ look: { preset: look?.preset ?? STORY_CAMERA_LOOK_PRESETS[0]?.id ?? "", intensity: next } })}
                    />
                    {/* The two facts an author cannot find out from a list of names: a grade REPLACES
                        whatever the last one put on this channel rather than layering onto it, and one
                        of them keeps moving instead of settling. */}
                    <p className="mt-1 text-2xs text-fg-subtle">{t("storyInspector.cameraLookHint.channel")}</p>
                    {look?.preset === "monologue" ? (
                        <p className="mt-1 text-2xs text-fg-subtle">{t("storyInspector.cameraLookHint.monologue")}</p>
                    ) : null}
                    {look?.preset === "hangover" ? (
                        <p className="mt-1 text-2xs text-fg-subtle">{t("storyInspector.cameraLookHint.hangover")}</p>
                    ) : null}
                </>
            ),
        };
    }
    if (channel.id === "filterRaw") {
        return {
            control: <ChannelText value={to.filterRaw ?? ""} placeholder="drop-shadow(0 0 6px #000)" onChange={filterRaw => setProps({ filterRaw })} />,
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
            below: <MaskSettings to={to} t={t} onChange={setProps} />,
        };
    }
    if (channel.id === "clip") {
        const value = to.clipPath ?? "";
        return {
            control: <ClipShapeControl value={value} t={t} onChange={clipPath => setProps({ clipPath })} />,
            below: <ClipShapeParams value={value} t={t} onChange={clipPath => setProps({ clipPath })} />,
        };
    }
    if (channel.id === "backdrop") {
        return {
            control: <BackdropControl value={to.backdropFilter ?? ""} t={t} onChange={backdropFilter => setProps({ backdropFilter })} />,
        };
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
        return { control: <ChannelNumber label={label} value={ref.repeat} onChange={repeat => patch({ ...ref, mode: "props", repeat })} fallback={1} /> };
    }
    if (channel.id === "delayMs" || channel.id === "repeatDelayMs") {
        const key = channel.id;
        return { control: <ChannelSeconds label={label} value={ref[key]} onChange={ms => patch({ ...ref, mode: "props", [key]: ms })} /> };
    }
    return { control: null };
}

// ---------------------------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------------------------

const PICKER_WIDTH_PX = 268;

/**
 * What a channel matches on: its own word, and the group it files under.
 *
 * Deliberately not the English id. An author who types `blur` is looking for 模糊 and would find it
 * through the localized label anyway when the interface is English; matching the id as well would
 * make a Chinese search for 色 also hit `scaleX`, which is noise dressed up as cleverness.
 */
function channelMatches(channel: TransformChannelSpec, query: string, t: TFunc): boolean {
    if (!query) {
        return true;
    }
    const needle = query.trim().toLowerCase();
    const haystack = `${channel.label(t)} ${t(`storyInspector.transformChannelGroup.${channel.group}` as TranslationKey)}`.toLowerCase();
    return haystack.includes(needle);
}

function AddChannelPicker(props: {
    channels: readonly TransformChannelSpec[];
    onAdd: (channel: TransformChannelSpec) => void;
    previewUrl: string | null;
    t: TFunc;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const searchBoxRef = useRef<HTMLDivElement | null>(null);

    /**
     * Put the caret in the search box once the panel is actually focusable.
     *
     * Two things defeat the obvious `autoFocus`. The panel is portalled, so the attribute is honoured
     * against a node that is not in the tree the author is looking at yet; and `AnchoredPanel` paints
     * its first frame `visibility: hidden` while it measures itself, and a hidden subtree cannot take
     * focus at all - `focus()` there is a silent no-op, which is exactly what it looked like.
     *
     * So the attempt is repeated for a few frames and stops as soon as it lands. Bounded rather than
     * polled: if the box has not taken focus within a handful of frames, something is holding it and
     * retrying forever would only hide that.
     */
    useEffect(() => {
        if (!open) {
            return;
        }
        let frame = 0;
        let raf = 0;
        const attempt = () => {
            const input = searchBoxRef.current?.querySelector("input");
            if (input && document.activeElement !== input) {
                input.focus();
            }
            frame += 1;
            if (frame < 12 && (!input || document.activeElement !== input)) {
                raf = requestAnimationFrame(attempt);
            }
        };
        raf = requestAnimationFrame(attempt);
        return () => cancelAnimationFrame(raf);
    }, [open]);

    const anchor = useCallback((): PanelAnchor | null => {
        const box = triggerRef.current?.getBoundingClientRect();
        return box ? { top: box.top, bottom: box.bottom, left: box.left } : null;
    }, []);

    const grouped = useMemo(() => TRANSFORM_CHANNEL_GROUPS
        .map(group => ({
            group,
            entries: props.channels.filter(channel => channel.group === group && channelMatches(channel, query, props.t)),
        }))
        .filter(entry => entry.entries.length > 0), [props.channels, query, props.t]);

    const close = () => {
        setOpen(false);
        setQuery("");
    };

    if (props.channels.length === 0) {
        return null;
    }
    return (
        <div className="pt-1">
            <button
                ref={triggerRef}
                type="button"
                className={cn(
                    "inline-flex items-center gap-1 rounded-md border border-edge px-2 text-2xs text-fg-muted",
                    "transition-colors duration-150 hover:bg-edge-subtle hover:text-fg",
                    CONTROL_HEIGHT_CLASS.sm,
                )}
                aria-expanded={open}
                onClick={() => (open ? close() : setOpen(true))}
            >
                <Plus className="h-3 w-3" />
                {props.t("storyInspector.transformChannel.add")}
            </button>
            {open ? (
                <AnchoredPanel
                    anchor={anchor}
                    width={PICKER_WIDTH_PX}
                    panelRef={panelRef}
                    role="dialog"
                    className="z-50 overflow-hidden rounded-lg border border-edge bg-surface-overlay shadow-lg"
                >
                    <div ref={searchBoxRef} className="border-b border-edge-subtle p-2">
                        <SearchInput
                            size="sm"
                            fullWidth
                            value={query}
                            placeholder={props.t("storyInspector.transformChannel.search")}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === "Escape") {
                                    close();
                                }
                            }}
                        />
                    </div>
                    <div className="max-h-80 overflow-y-auto p-1">
                        {grouped.length === 0 ? (
                            <div className="px-2 py-6 text-center text-2xs text-fg-subtle">
                                {props.t("storyInspector.transformChannel.noMatch")}
                            </div>
                        ) : grouped.map(({ group, entries }) => (
                            <div key={group} className="mb-1 last:mb-0">
                                <FieldLabel as="div" className="px-2 pt-1">
                                    {props.t(`storyInspector.transformChannelGroup.${group}` as TranslationKey)}
                                </FieldLabel>
                                {entries.map(channel => (
                                    <button
                                        key={channel.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg-muted transition-colors duration-150 hover:bg-edge-subtle hover:text-fg"
                                        onClick={() => {
                                            props.onAdd(channel);
                                            close();
                                        }}
                                    >
                                        <TransformChannelPreview channelId={channel.id} imageUrl={props.previewUrl} />
                                        <span className="min-w-0 flex-1 truncate">{channel.label(props.t)}</span>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                </AnchoredPanel>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------

export function TransformChannelEditor(props: {
    value: StoryTransformRef | undefined;
    /**
     * What this row transforms. `camera` is a subject like any other since v19 - the stage camera IS
     * a Displayable and takes the same bag - and it is spelled here rather than in
     * `StoryDisplayableTargetKind` because that union is about objects a scene creates.
     */
    targetKind: StoryDisplayableTargetKind | "camera";
    /**
     * The image this row transforms, when the row transforms something that has one.
     *
     * Absent is the normal case, not a failure: a text object, a layer and a puppet character have
     * no single picture to grade, and the preview falls back to the bundled portrait rather than
     * showing an empty frame.
     */
    previewAssetId?: string;
    onChange: (value: StoryTransformRef) => void;
}) {
    const { t } = useTranslation();
    const preview = useAssetObjectUrl(props.previewAssetId, AssetType.Image);
    const ref: StoryTransformRef = props.value ?? { mode: "props" };
    const stated = statedTransformChannels(ref);
    const addable = addableTransformChannels(ref, { isText: props.targetKind === "text", isCamera: props.targetKind === "camera" });
    const removeLabel = t("storyInspector.transformChannel.remove");

    return (
        <div className="flex flex-col gap-1.5">
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
            <AddChannelPicker
                channels={addable}
                previewUrl={preview.url}
                t={t}
                onAdd={channel => props.onChange(channel.add(ref))}
            />
        </div>
    );
}
