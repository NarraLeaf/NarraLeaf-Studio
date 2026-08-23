import { useState, type CSSProperties, type ReactNode } from "react";
import { Quote } from "lucide-react";
import { useCommandTranslation, useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SOURCE_LOCALE, type TranslationKey } from "@shared/i18n";
import { getCommandGroup } from "@/apps/workspace/modules/story/scene-editor/storyCommandCategories";
import type { StoryPreferences } from "../onboardingPreferences";

/**
 * A scene nobody wrote, drawn the way the scene editor draws one.
 *
 * **Hand-built rather than the editor itself.** `StorySceneEditorRows` is a row that resolves
 * characters, assets, variables and audio tracks out of a loaded project, and there is no project in
 * the launcher window - so mounting it here would mean inventing a workspace to hold a picture. What
 * this shares with the real editor instead is everything that decides how a row LOOKS: the two-layer
 * tint, the gutter's mark vocabulary (a face for the script, a bare glyph for the machinery), the
 * four command roles and their colours, and the type the author picked. The preferences reach it as
 * props, from the same keys the settings window writes.
 *
 * The one rule it restates rather than imports is how a command word and a parameter key are spelled
 * in the command language: the real answer lives in `commands/registry.ts` and
 * `commands/localizedParams.ts`, behind a command definition this file has no way to hold. Both say
 * the same thing - the source locale writes the canonical ASCII token, every other locale writes its
 * own word - and both read the same two catalog keys, so a translation lands in the preview and in
 * the editor at once.
 */

/** How wide the line-number column is drawn, and the mark column beside it (gutter 规范 §6). */
const NUMBER_COLUMN_PX = 28;
const MARK_COLUMN_PX = 26;
/** A directive's glyph is drawn smaller than a face, so it does not outweigh the script. */
const COMMAND_GLYPH_PX = 18;
const COMMAND_STROKE = 1.6;

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

/**
 * The four roles a command line is coloured by (`storyCommandHighlight`), in the classes the
 * committed row uses. One colour per role and never a rainbow: the eye has to be able to answer
 * "which word is the verb" without reading.
 */
const ROLE_VERB = "text-primary font-medium";
const ROLE_TARGET = "text-syntax-target";
const ROLE_VALUE = "text-syntax-value";
const ROLE_SCAFFOLD = "text-fg-subtle";

interface StoryScenePreviewProps {
    story: StoryPreferences;
    /** The type the story text is set in, from `editor.fontSize` / `editor.fontFamily`. */
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
     * it).
     */
    const [selected, setSelected] = useState<number | null>(null);
    const [insertFocused, setInsertFocused] = useState(false);

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

    const commandLine = (command: SampleCommand): ReactNode => (
        <span className="whitespace-pre-wrap break-words">
            <span className={ROLE_SCAFFOLD}>{trigger}</span>
            <span className={ROLE_VERB}>{verb(command)}</span>
            <span className={ROLE_SCAFFOLD}> </span>
            <span className={ROLE_TARGET}>{command.target}</span>
            {command.params.map(param => (
                <span key={param.key}>
                    <span className={ROLE_SCAFFOLD}> </span>
                    {/* Dropped, keys and binder together, when the row prints values alone
                        (`editor.hideParamNames`). The space in front of them stays - it separates
                        two values just as it separated two modifiers. */}
                    {story.hideParamNames ? null : <span className={ROLE_SCAFFOLD}>{paramKey(param)}=</span>}
                    <span className={ROLE_VALUE}>{param.value}</span>
                </span>
            ))}
        </span>
    );

    /** A row of the machine layer: a directive, marked by a bare line drawing in its group's hue. */
    const commandRow = (index: number, groupId: "scene" | "character", command: SampleCommand) => {
        const group = getCommandGroup(groupId);
        const Icon = group.icon;
        return (
            <PreviewRow
                key={index}
                index={index}
                number={index + 1}
                layer="machine"
                highlight={story.rowHighlight}
                selected={selected === index}
                onSelect={() => setSelected(index)}
                mark={
                    <Icon
                        aria-hidden
                        style={{ width: COMMAND_GLYPH_PX, height: COMMAND_GLYPH_PX, color: group.iconColor }}
                        strokeWidth={COMMAND_STROKE}
                    />
                }
                textStyle={textStyle}
            >
                {commandLine(command)}
            </PreviewRow>
        );
    };

    return (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
                textStyle={textStyle}
            >
                <span className="mr-1.5 font-medium text-fg">{t("onboarding.sample.speaker")}</span>
                <span className="text-fg">{t("onboarding.sample.line")}</span>
            </PreviewRow>

            {/* The continuation drops the name - the paragraph was named above it - and its gutter
                carries the run's rule instead of a mark. */}
            <PreviewRow
                index={2}
                number={3}
                layer="script"
                highlight={story.rowHighlight}
                selected={selected === 2}
                onSelect={() => setSelected(2)}
                mark={<span aria-hidden className="block h-full w-px bg-primary/50" />}
                markClassName="flex justify-center self-stretch"
                textStyle={textStyle}
            >
                <span className="text-fg">{t("onboarding.sample.lineContinued")}</span>
            </PreviewRow>

            <PreviewRow
                index={3}
                number={4}
                layer="script"
                highlight={story.rowHighlight}
                selected={selected === 3}
                onSelect={() => setSelected(3)}
                mark={<NarratorRing />}
                textStyle={textStyle}
            >
                <span className="text-fg-muted">{t("onboarding.sample.narration")}</span>
            </PreviewRow>

            {commandRow(4, "character", show)}

            {/* The insert slot, which is where the trigger character is actually advertised - and
                the reason `editor.slashAtAlias` is worth a question rather than a footnote. */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setInsertFocused(true)}
                onBlur={() => setInsertFocused(false)}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setInsertFocused(true);
                    }
                }}
                className={cn(
                    "mt-0.5 grid cursor-text grid-cols-[var(--nl-preview-number)_var(--nl-preview-mark)_1fr] items-center border-l-2 border-transparent pr-3",
                    insertFocused ? "bg-fill-subtle" : "hover:bg-fill-subtle",
                )}
                style={numberColumns}
            >
                <span />
                <span />
                <span className="flex min-h-[24px] items-center truncate text-fg-subtle" style={textStyle}>
                    {insertFocused ? (
                        <>
                            <span className={ROLE_SCAFFOLD}>{trigger}</span>
                            <span className="ml-px inline-block h-[1.1em] w-px bg-fg align-middle" />
                        </>
                    ) : (
                        t("story.rows.insertPlaceholder", { trigger })
                    )}
                </span>
            </div>
        </div>
    );
}

/** The column widths, published once so every row and the insert slot measure from one place. */
const numberColumns = {
    "--nl-preview-number": `${NUMBER_COLUMN_PX}px`,
    "--nl-preview-mark": `${MARK_COLUMN_PX}px`,
} as CSSProperties;

interface PreviewRowProps {
    index: number;
    number: number;
    /** Which of the editor's two layers this row is in - the script, or the machinery. */
    layer: "script" | "machine";
    highlight: StoryPreferences["rowHighlight"];
    selected: boolean;
    onSelect: () => void;
    mark: ReactNode;
    markClassName?: string;
    textStyle: CSSProperties;
    children: ReactNode;
}

function PreviewRow({ number, layer, highlight, selected, onSelect, mark, markClassName, textStyle, children }: PreviewRowProps) {
    // The tint is withdrawn under selection: a selected row paints its whole background, and a
    // tint beneath it would only mix with the one on top.
    const tinted = highlight !== "none" && layer === (highlight === "script" ? "script" : "machine") && !selected;

    return (
        <div
            onClick={onSelect}
            className={cn(
                "group relative grid min-h-[28px] cursor-default grid-cols-[var(--nl-preview-number)_var(--nl-preview-mark)_1fr] items-start border-l-2 pr-3",
                selected ? "border-primary bg-primary/20" : "border-transparent hover:bg-fill-subtle",
            )}
            style={numberColumns}
        >
            {tinted ? <span aria-hidden className="pointer-events-none absolute inset-0 bg-fill-subtle" /> : null}
            <div className="pr-2 pt-1 text-right text-2xs tabular-nums text-fg-subtle/60 transition-colors group-hover:text-fg-subtle">
                {number}
            </div>
            <div className={cn("relative pt-0.5", markClassName)}>{mark}</div>
            <div className="relative min-w-0 py-1" style={textStyle}>
                {children}
            </div>
        </div>
    );
}

/**
 * A character is a picture: a colour disc bearing their first grapheme, when there is no portrait.
 *
 * The disc takes the accent rather than a colour of its own - a sample character has no colour to
 * have been given one, and borrowing the accent makes the appearance step's choice visible here too.
 */
function SpeakerDisc({ name }: { name: string }) {
    return (
        <span
            aria-hidden
            className="grid place-items-center rounded-full bg-primary/25 text-2xs font-medium text-fg"
            style={{ width: MARK_COLUMN_PX, height: MARK_COLUMN_PX }}
        >
            {[...name][0] ?? ""}
        </span>
    );
}

/** The narrator is a hollow ring around a quote - the one mark that is a container and not a face. */
function NarratorRing() {
    return (
        <span
            aria-hidden
            className="grid place-items-center rounded-full border border-edge-strong text-fg-subtle"
            style={{ width: MARK_COLUMN_PX, height: MARK_COLUMN_PX }}
        >
            <Quote className="h-3 w-3" strokeWidth={COMMAND_STROKE} />
        </span>
    );
}
