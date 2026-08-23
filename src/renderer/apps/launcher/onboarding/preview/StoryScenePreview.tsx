import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, ChevronRight, Code, FileText, Filter, MonitorPlay, Quote, Rows3 } from "lucide-react";
import { useCommandTranslation, useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SOURCE_LOCALE, type TranslationKey } from "@shared/i18n";
import { getCommandGroup } from "@/apps/workspace/modules/story/scene-editor/storyCommandCategories";
import type { StoryPreferences } from "../onboardingPreferences";
import { SampleCommandMenu, filterSampleCommands, useSampleCommandLabels } from "./SampleCommandMenu";

/**
 * A scene nobody wrote, drawn the way the scene editor draws one.
 *
 * **Hand-built rather than the editor itself.** `StorySceneEditorTab` resolves characters, assets,
 * variables and audio tracks out of a loaded project, and there is no project in the launcher
 * window - mounting it here would mean inventing a workspace to hold a picture. So the markup is
 * copied instead, element for element, from the editor it stands for: the 44px document header and
 * its view controls, the collapsed scene card, the `[gutter | content]` row grid, the 26px mark
 * column and the 12px boundary after it, the four command roles and the dotted underline under
 * every value a click can change, the speaker's own hue on the nametag and on the continuation
 * rule. An author who finishes setup should recognise the editor that opens.
 *
 * The metrics are restated rather than imported: the modules that own them
 * (`storyEditorTextStyle.tsx`, `StoryRowGutterMark.tsx`) pull in the character editor's thumbnail
 * and the workspace's settings hooks behind them, which is a large part of the workspace bundle for
 * four numbers. They are named here beside the numbers so a change over there is findable.
 *
 * The one rule it restates rather than imports is how a command word and a parameter key are
 * spelled in the command language: the real answer lives in `commands/registry.ts` and
 * `commands/localizedParams.ts`, behind a command definition this file has no way to hold. Both say
 * the same thing - the source locale writes the canonical ASCII token, every other locale writes its
 * own word - and both read the same two catalog keys, so a translation lands in the preview and in
 * the editor at once.
 */

/** `STORY_DENSITY_METRICS.compact.rowBox` - the single-line box every column centres in. */
const ROW_BOX_PX = 28;
/** `storyGutterWidth(rowCount)` at two digits - the line-number column. */
const GUTTER_PX = 38;
/** `STORY_MARK_PX` - the identity column, fixed at every density. */
const MARK_PX = 26;
/** The boundary between the mark and the words (gutter 规范 §6). */
const MARK_GAP_PX = 12;
/** A directive's glyph, drawn smaller than a face so it does not outweigh the script. */
const COMMAND_GLYPH_PX = 18;
/** The stroke every drawn glyph in the column shares. */
const COMMAND_STROKE = 1.6;
/** The hue the sample speaker is filed under; `.nl-speaker` turns it into disc, ink and nametag. */
const SPEAKER_HUE = 152;

/** The row grid's own variables, published the way `storyEditorRootStyle` publishes them. */
const ROOT_VARS = {
    "--nl-story-row-box": `${ROW_BOX_PX}px`,
    "--nl-story-gutter": `${GUTTER_PX}px`,
    "--nl-story-mark": `${MARK_PX}px`,
} as CSSProperties;

/** One modifier of a sample command: the key as the parser spells it, and the word for it. */
interface SampleParam {
    /** The canonical ASCII key - what an English author types, and what the line stores. */
    key: string;
    /** `story.paramHint.*`, the same key `localizedParamKey` reads for this slot's own word. */
    hintKey: TranslationKey;
    value: string;
}

interface SampleCommand {
    /** The canonical token, written in the source locale. */
    token: string;
    /** `story.command.<id>.label`, the word every other locale writes instead. */
    labelKey: TranslationKey;
    target: string;
    params: SampleParam[];
}

/** Tailwind classes per command role (`storyCommandHighlight`), as the committed row uses them. */
const ROLE_VERB = "text-primary font-medium";
const ROLE_TARGET = "text-syntax-target";
const ROLE_VALUE = "text-syntax-value";
const ROLE_SCAFFOLD = "text-fg-subtle";
/** The affordance under a value a click can change. Drawn, not wired: this pane edits nothing. */
const EDITABLE = "rounded-md px-0.5 underline decoration-dotted decoration-fg-subtle/60 underline-offset-2";

interface StoryScenePreviewProps {
    story: StoryPreferences;
    /** The type story text is set in, from `editor.fontSize` / `editor.fontFamily`. */
    textStyle: CSSProperties;
}

export function StoryScenePreview({ story, textStyle }: StoryScenePreviewProps) {
    const { t } = useTranslation();
    const tc = useCommandTranslation();
    /**
     * Which row is selected, so the pane answers a click the way the editor does.
     *
     * The whole point of showing the settings against a scene is that the scene can be poked at:
     * hover a row, pick one, watch the tint withdraw under the selection exactly as it does in the
     * editor (a selected row paints its own background, and a tint underneath would only mix with
     * it). Everything around it - the header's controls, the scene card - is inert.
     */
    const [selected, setSelected] = useState<number | null>(null);
    /**
     * What has been typed into the insert slot.
     *
     * The one thing in this window that takes input, and deliberately so: the slot is where a line
     * starts in the real editor, and the trigger character - the thing `editor.slashAtAlias` is
     * about - is only ever met by typing it. Nothing is committed; there is no document under this
     * to commit to. What it buys is the gesture: type the trigger, the action creator opens, the
     * words in it are in whichever language the command vocabulary is set to.
     */
    const [draft, setDraft] = useState("");
    const [insertFocused, setInsertFocused] = useState(false);
    const [activeToken, setActiveToken] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const commandLabel = useSampleCommandLabels();

    const trigger = story.slashAtAlias ? "@" : "/";
    /** The command language, which the vocabulary is spelled in - not the interface language. */
    const commandLocale = tc.locale;

    const verb = (command: SampleCommand): string =>
        (commandLocale === SOURCE_LOCALE ? command.token : tc.t(command.labelKey).trim().toLowerCase());
    const paramKey = (param: SampleParam): string =>
        (commandLocale === SOURCE_LOCALE ? param.key : tc.t(param.hintKey).trim());

    const background: SampleCommand = {
        token: "bg",
        labelKey: "story.command.background.label",
        target: t("onboarding.sample.background"),
        params: [
            { key: "t", hintKey: "story.paramHint.transition", value: t("onboarding.sample.transition") },
            { key: "d", hintKey: "story.paramHint.duration", value: "1" },
        ],
    };
    const show: SampleCommand = {
        token: "show",
        labelKey: "story.command.show.label",
        target: t("onboarding.sample.speaker"),
        params: [
            { key: "at", hintKey: "story.paramHint.placement", value: t("onboarding.sample.placement") },
            { key: "t", hintKey: "story.paramHint.transition", value: t("onboarding.sample.transition") },
        ],
    };

    /** A committed command line, coloured by role and dimmed the way a committed row is. */
    /**
     * What has been typed after the trigger, or null when this is not a command line at all.
     *
     * Both triggers are accepted whichever one the setting advertises, exactly as the editor's own
     * parser does: "@" is an alias for "/" rather than a replacement, so a script written on one
     * machine goes on parsing on another.
     */
    const commandQuery = /^[/@]/.test(draft) ? draft.slice(1) : null;
    const candidates = useMemo(
        () => (commandQuery === null ? [] : filterSampleCommands(commandQuery, commandLabel)),
        // `commandLabel` closes over the command translator, which changes with the vocabulary.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [commandQuery, commandLocale],
    );

    /** Take a command from the menu: the line becomes the verb, and the caret waits after it. */
    const writeCommand = (token: string) => {
        setDraft(`${trigger}${commandLabel(token)} `);
        setActiveToken(null);
        inputRef.current?.focus({ preventScroll: true });
    };

    const commandLine = (command: SampleCommand): ReactNode => (
        <span
            className="flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center text-sm opacity-80"
            style={textStyle}
        >
            <span className="min-w-0 truncate">
                <span className={ROLE_SCAFFOLD}>{trigger}</span>
                <span className={ROLE_VERB}>{verb(command)}</span>
                <span className={ROLE_SCAFFOLD}> </span>
                <span className={EDITABLE}><span className={ROLE_TARGET}>{command.target}</span></span>
                {command.params.map(param => (
                    <span key={param.key}>
                        <span className={ROLE_SCAFFOLD}> </span>
                        {/* Dropped, key and binder together, when the row prints values alone
                            (`editor.hideParamNames`). The space in front of them stays - it
                            separated two modifiers and now separates two values. */}
                        {story.hideParamNames ? null : <span className={ROLE_SCAFFOLD}>{paramKey(param)}=</span>}
                        <span className={EDITABLE}><span className={ROLE_VALUE}>{param.value}</span></span>
                    </span>
                ))}
            </span>
        </span>
    );

    /** A row of the machine layer: a directive, marked by a bare line drawing in its group's hue. */
    const commandRow = (index: number, groupId: "scene" | "character", command: SampleCommand) => {
        const group = getCommandGroup(groupId);
        const Icon = group.icon;
        return (
            <PreviewRow
                index={index}
                number={index + 1}
                layer="machine"
                highlight={story.rowHighlight}
                selected={selected === index}
                onSelect={() => setSelected(index)}
                mark={(
                    <Icon
                        aria-hidden
                        style={{ width: COMMAND_GLYPH_PX, height: COMMAND_GLYPH_PX, color: group.iconColor }}
                        strokeWidth={COMMAND_STROKE}
                        className="shrink-0"
                    />
                )}
            >
                {commandLine(command)}
            </PreviewRow>
        );
    };

    /** The words of a spoken or narrated row, in the surface the editor puts a caret in. */
    const prose = (text: string) => (
        <div
            className="flex min-w-0 flex-1 items-center self-stretch text-fg"
            style={{ ...textStyle, paddingBlock: 4, marginBlock: -4 }}
        >
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{text}</span>
        </div>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col" style={ROOT_VARS}>
            {/* The document header: what is open, which story it is in, and the view controls. */}
            <div aria-hidden className="flex min-h-[44px] shrink-0 items-center gap-3 border-b border-edge px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{t("onboarding.sample.scene")}</div>
                        <div className="truncate text-2xs text-fg-muted">{t("onboarding.sample.storyName")}</div>
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1 text-fg-muted">
                    <Filter className="mx-1.5 h-4 w-4" />
                    <Rows3 className="mx-1.5 h-4 w-4" />
                    <Code className="mx-1.5 h-4 w-4" />
                    <BookOpen className="mx-1.5 h-4 w-4" />
                    <span className="mx-1 h-4 w-px shrink-0 bg-edge" />
                    <span className="flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-xs">
                        <MonitorPlay className="h-4 w-4" />
                        {t("story.preview.label")}
                    </span>
                </div>
            </div>

            <div className="nl-editor-surface min-h-0 flex-1 overflow-auto py-2">
                {/* The scene's own card, collapsed - where the editor keeps the background and the
                    description that belong to the scene rather than to any row in it. */}
                <div aria-hidden className="mx-3 mb-3 overflow-hidden rounded-lg border border-edge bg-fill-subtle">
                    <div className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
                        <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
                        <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md border border-edge bg-surface" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">{t("onboarding.sample.scene")}</span>
                            <span className="block truncate text-2xs text-fg-subtle">{t("story.sceneEditor.noDescription")}</span>
                        </span>
                    </div>
                </div>

                {commandRow(0, "scene", background)}

                {/* A paragraph is named once, at its head, and the name is printed in front of the
                    words rather than filed in a column beside them. */}
                <PreviewRow
                    index={1}
                    number={2}
                    layer="script"
                    highlight={story.rowHighlight}
                    selected={selected === 1}
                    onSelect={() => setSelected(1)}
                    mark={<SpeakerDisc name={t("onboarding.sample.speaker")} />}
                >
                    <span className="flex min-h-[var(--nl-story-row-box)] shrink-0 items-center" style={textStyle}>
                        <span
                            className="nl-speaker -ml-1 box-content flex w-fit max-w-full items-center truncate rounded-md px-1 py-0.5 text-left font-medium"
                            style={{ "--nl-speaker-h": SPEAKER_HUE, color: "var(--nl-speaker-name)" } as CSSProperties}
                        >
                            <span className="truncate">{t("onboarding.sample.speaker")}</span>
                        </span>
                    </span>
                    {prose(t("onboarding.sample.line"))}
                </PreviewRow>

                {/* The continuation drops the name - the paragraph was named above it - and its
                    gutter carries the run's rule instead of a mark. */}
                <PreviewRow
                    index={2}
                    number={3}
                    layer="script"
                    highlight={story.rowHighlight}
                    selected={selected === 2}
                    onSelect={() => setSelected(2)}
                    mark={(
                        <span
                            aria-hidden
                            className="nl-speaker flex-1"
                            style={{
                                "--nl-speaker-h": SPEAKER_HUE,
                                width: 1,
                                marginTop: -4,
                                marginBottom: -4,
                                minHeight: MARK_PX,
                                backgroundColor: "var(--nl-speaker-disc)",
                                opacity: 0.55,
                            } as CSSProperties}
                        />
                    )}
                    markFills
                >
                    {prose(t("onboarding.sample.lineContinued"))}
                </PreviewRow>

                <PreviewRow
                    index={3}
                    number={4}
                    layer="script"
                    highlight={story.rowHighlight}
                    selected={selected === 3}
                    onSelect={() => setSelected(3)}
                    mark={<NarratorRing />}
                >
                    {prose(t("onboarding.sample.narration"))}
                </PreviewRow>

                {commandRow(4, "character", show)}

                {/* The insert slot: where a line starts, where the trigger character is advertised,
                    and the one thing here that takes input. */}
                <div
                    onClick={() => inputRef.current?.focus({ preventScroll: true })}
                    className={cn(
                        "grid cursor-text grid-cols-[var(--nl-story-gutter)_1fr] items-start border-l-2 border-transparent pr-3",
                        insertFocused ? "bg-fill-subtle" : "hover:bg-fill-subtle",
                    )}
                >
                    <span />
                    <div className="relative min-w-0 py-1">
                        <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-center" style={{ gap: MARK_GAP_PX }}>
                            <span className="shrink-0" style={{ width: MARK_PX }} />
                            <div className="relative min-w-0 flex-1">
                                <input
                                    ref={inputRef}
                                    value={draft}
                                    placeholder={t("story.rows.insertPlaceholder", { trigger })}
                                    onFocus={() => setInsertFocused(true)}
                                    onBlur={() => setInsertFocused(false)}
                                    onChange={event => {
                                        setDraft(event.target.value);
                                        setActiveToken(null);
                                        // Typing implies the caret is here, and says so even where
                                        // the focus event did not reach us - a window that is not
                                        // the one the operating system considers focused still has
                                        // a caret, and the menu has to open under it.
                                        setInsertFocused(true);
                                    }}
                                    onKeyDown={event => {
                                        // `""` is a command line with nothing typed after the
                                        // trigger, which is exactly when the menu is longest.
                                        if (commandQuery === null) {
                                            return;
                                        }
                                        if (event.key === "Escape") {
                                            event.preventDefault();
                                            setDraft("");
                                            return;
                                        }
                                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                            event.preventDefault();
                                            const step = event.key === "ArrowDown" ? 1 : -1;
                                            const at = candidates.findIndex(entry => entry.token === activeToken);
                                            const next = candidates[(Math.max(0, at) + step + candidates.length) % candidates.length];
                                            setActiveToken(next?.token ?? null);
                                            return;
                                        }
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            const chosen = candidates.find(entry => entry.token === activeToken) ?? candidates[0];
                                            if (chosen) {
                                                writeCommand(chosen.token);
                                            }
                                        }
                                    }}
                                    className="w-full min-w-0 truncate border-none bg-transparent p-0 text-fg outline-none placeholder:text-fg-subtle"
                                    style={textStyle}
                                />
                                {commandQuery !== null && insertFocused ? (
                                    <SampleCommandMenu
                                        query={commandQuery}
                                        activeToken={activeToken}
                                        onHighlight={setActiveToken}
                                        onChoose={writeCommand}
                                    />
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface PreviewRowProps {
    index: number;
    number: number;
    /** Which of the editor's two layers this row is in - the script, or the machinery. */
    layer: "script" | "machine";
    highlight: StoryPreferences["rowHighlight"];
    selected: boolean;
    onSelect: () => void;
    mark: ReactNode;
    /** The mark spans the row rather than centring in the single-line box (the continuation rule). */
    markFills?: boolean;
    children: ReactNode;
}

/**
 * One row, in the editor's own grid: the line number in the gutter column, then a content column
 * holding the mark, the words and whatever trails them.
 */
function PreviewRow({ number, layer, highlight, selected, onSelect, mark, markFills, children }: PreviewRowProps) {
    // The tint is withdrawn under selection: a selected row paints its whole background, and a
    // tint beneath it would only mix with the one on top.
    const tinted = highlight !== "none" && layer === (highlight === "script" ? "script" : "machine") && !selected;

    return (
        <div
            onClick={onSelect}
            className={cn(
                "group relative grid min-h-[calc(var(--nl-story-row-box)+0.5rem)] cursor-default grid-cols-[var(--nl-story-gutter)_1fr] items-start border-l-2 pr-3",
                selected ? "border-primary bg-primary/20" : "border-transparent hover:bg-fill-subtle",
            )}
        >
            {tinted ? <span aria-hidden className="pointer-events-none absolute inset-0 bg-fill-subtle" /> : null}
            <div className="relative flex h-full items-start justify-end pr-2 pt-1 text-2xs tabular-nums text-fg-subtle/60 transition-colors group-hover:text-fg-subtle">
                <div className="flex min-h-[var(--nl-story-row-box)] items-center gap-0.5">
                    {/* The fold chevron's slot, held open on every row so the numbers line up. */}
                    <span className="h-3.5 w-3.5" />
                    <span>{number}</span>
                </div>
            </div>
            <div className="relative min-w-0 py-1">
                <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-start" style={{ gap: MARK_GAP_PX }}>
                    <span
                        aria-hidden
                        className="relative flex shrink-0 flex-col items-center self-stretch"
                        style={{ width: MARK_PX, minHeight: "var(--nl-story-row-box)" }}
                    >
                        {markFills ? mark : (
                            <span
                                className="relative flex w-full shrink-0 items-center justify-center"
                                style={{ height: "var(--nl-story-row-box)" }}
                            >
                                {mark}
                            </span>
                        )}
                    </span>
                    {children}
                </div>
            </div>
        </div>
    );
}

/**
 * A character is a picture: a colour disc bearing their first grapheme, when there is no portrait.
 *
 * The disc, its ink and the nametag all come from one hue through `.nl-speaker`, which is where the
 * cast's colours are resolved for both themes - so the sample character is coloured by the same
 * rule every real one is.
 */
function SpeakerDisc({ name }: { name: string }) {
    return (
        <span
            className="nl-speaker flex shrink-0 select-none items-center justify-center rounded-full font-medium leading-none"
            style={{
                "--nl-speaker-h": SPEAKER_HUE,
                width: MARK_PX,
                height: MARK_PX,
                fontSize: 12.5,
                backgroundColor: "var(--nl-speaker-disc)",
                color: "var(--nl-speaker-ink)",
            } as CSSProperties}
        >
            {[...name][0] ?? ""}
        </span>
    );
}

/** The narrator is a hollow ring around a quote - a container, and never a face. */
function NarratorRing() {
    return (
        <span
            className="flex shrink-0 select-none items-center justify-center rounded-full border border-edge-strong text-fg-muted"
            style={{ width: MARK_PX, height: MARK_PX }}
        >
            <Quote className="shrink-0" style={{ width: 11, height: 11, transform: "rotate(180deg)" }} strokeWidth={COMMAND_STROKE} />
        </span>
    );
}
