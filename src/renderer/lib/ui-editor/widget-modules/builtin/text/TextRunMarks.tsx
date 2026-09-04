import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, Superscript, Type as TypeIcon } from "lucide-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import {
    applyPlainTextToUITextRuns,
    setUITextRunMark,
    uiTextRunMarksInRange,
    type UITextRunMarks,
} from "@shared/types/ui-editor/textRuns";
import { DraftTextInput } from "@/lib/components/inputs/DraftTextInput";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { TooltipGroup } from "@/lib/tooltip";
import { useTranslation } from "@/lib/i18n";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
// The two panels that set a run's marks. A dialogue line and a label carry the same marks, so they
// are set by the same controls rather than by a second pair that would have to be kept in step.
import { RubyPopover } from "@/apps/workspace/modules/story/scene-editor/RubyPopover";
import { TypePopover } from "@/apps/workspace/modules/story/scene-editor/TypePopover";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { getTextProps, textValuePatch } from "./helpers";

const TEXT_AREA_CLASS =
    "min-h-[88px] w-full resize-y rounded-md border border-edge bg-surface-sunken px-2 py-1.5 text-xs "
    + "text-fg outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/40";

type Anchor = { top: number; left: number; bottom: number };

function anchorOf(element: HTMLElement | null): Anchor | null {
    if (!element) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, bottom: rect.bottom };
}

/**
 * The label's text, and the marks set over the characters selected in it.
 *
 * The box holds the plain string, and the marks are written over a selection made in it - the same
 * bargain the story row's toolbar strikes, where the marks are pressed over the words that are
 * selected rather than chosen for the line as a whole. What a mark actually looks like is on the
 * canvas, at the size, colour and writing direction the label is really set in, which is where an
 * author is looking when they decide a word needs a reading over it.
 *
 * Every write goes out as one patch carrying both `text` and `rich`: the box may be a keystroke or
 * two ahead of the document, and reading the marks against a string the document has not caught up
 * with is how an offset lands on the wrong character.
 */
export function TextRunMarksEditor(props: {
    documentService: UIDocumentService;
    element: UIElement;
    readOnly?: boolean;
}) {
    const { t } = useTranslation();
    const { documentService, element } = props;
    useUIDocumentRevision(documentService);
    const areaRef = useRef<(HTMLTextAreaElement & HTMLInputElement) | null>(null);
    const rubyButtonRef = useRef<HTMLButtonElement | null>(null);
    const typeButtonRef = useRef<HTMLButtonElement | null>(null);
    const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const [ruby, setRuby] = useState<Anchor | null>(null);
    const [type, setType] = useState<Anchor | null>(null);

    const live = documentService.getDocument().elements[element.id] ?? element;
    const textProps = getTextProps(live);

    useEffect(() => {
        const read = () => {
            const area = areaRef.current;
            if (!area || document.activeElement !== area) {
                return;
            }
            setSelection({ start: area.selectionStart ?? 0, end: area.selectionEnd ?? 0 });
        };
        document.addEventListener("selectionchange", read);
        return () => document.removeEventListener("selectionchange", read);
    }, []);

    // A panel is opened over the characters that were selected when it opened, and it takes the
    // focus away from the box to do it. The range is captured here so the panel's second press
    // writes to the same characters as its first.
    const marked = selection.end > selection.start;

    const setMark = useCallback(<K extends keyof UITextRunMarks>(
        key: K,
        value: UITextRunMarks[K] | undefined,
        range?: { start: number; end: number },
    ) => {
        const area = areaRef.current;
        if (!area) {
            return;
        }
        const text = area.value;
        const start = range?.start ?? area.selectionStart ?? 0;
        const end = range?.end ?? area.selectionEnd ?? 0;
        if (end <= start) {
            return;
        }
        const stored = getTextProps(documentService.getDocument().elements[element.id] ?? element);
        const base = stored.text === text ? stored.rich : applyPlainTextToUITextRuns(stored.rich, text);
        documentService.updateElementProps(element.id, {
            text,
            rich: setUITextRunMark(base, text, start, end, key, value),
        });
        // The press moved the focus off the box; the selection it was written for goes back on it,
        // so a second mark lands on the same characters without the author reselecting them.
        requestAnimationFrame(() => {
            area.focus();
            area.setSelectionRange(start, end);
            setSelection({ start, end });
        });
    }, [documentService, element]);

    const active: UITextRunMarks | undefined = marked
        ? uiTextRunMarksInRange(textProps.rich, textProps.text, selection.start, selection.end)
        : undefined;
    const disabled = props.readOnly === true || !marked;
    const hint = t("widgets.textMarks.selectHint");

    return (
        <div className="flex flex-col gap-1.5">
            <DraftTextInput
                multiline
                inputRef={areaRef}
                className={TEXT_AREA_CLASS}
                value={textProps.text}
                rows={4}
                readOnly={props.readOnly}
                draftResetKey={element.id}
                readCommittedValue={() =>
                    getTextProps(documentService.getDocument().elements[element.id] ?? element).text
                }
                onCommit={next => {
                    const stored = documentService.getDocument().elements[element.id] ?? element;
                    documentService.updateElementProps(element.id, textValuePatch(stored, next));
                }}
            />
            <TooltipGroup className="flex items-center gap-1">
                <span className="mr-1 text-2xs font-medium tracking-wide text-fg-muted">
                    {t("widgets.textMarks.title")}
                </span>
                <ToolbarButton
                    size="xs"
                    disabled={disabled}
                    active={Boolean(active?.bold)}
                    aria-label={disabled ? hint : t("story.richText.bold")}
                    data-tip={disabled ? hint : t("story.richText.bold")}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setMark("bold", active?.bold ? undefined : true)}
                >
                    <Bold className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton
                    size="xs"
                    disabled={disabled}
                    active={Boolean(active?.italic)}
                    aria-label={disabled ? hint : t("story.richText.italic")}
                    data-tip={disabled ? hint : t("story.richText.italic")}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setMark("italic", active?.italic ? undefined : true)}
                >
                    <Italic className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ColorPickerTrigger
                    displayMode="swatch"
                    allowOpacity={false}
                    disabled={disabled}
                    ariaLabel={disabled ? hint : t("story.richText.textColor", { color: active?.color ?? "" })}
                    value={parseColorValue(active?.color ?? textProps.color, { hex: "#FFFFFF", alpha: 1 })}
                    onChange={() => undefined}
                    // A run's colour reaches the engine as a CSS colour, so it is stored as one: a
                    // link into the project palette has nothing to resolve it on the way out.
                    onCommit={value => setMark("color", value.hex)}
                />
                <ToolbarButton
                    ref={typeButtonRef}
                    size="xs"
                    disabled={disabled}
                    active={Boolean(active?.emphasis) || active?.fontSizeStep !== undefined}
                    aria-label={disabled ? t("story.richText.typeHint") : t("story.richText.type")}
                    data-tip={disabled ? t("story.richText.typeHint") : t("story.richText.type")}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setType(current => (current ? null : anchorOf(typeButtonRef.current)))}
                >
                    <TypeIcon className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton
                    ref={rubyButtonRef}
                    size="xs"
                    disabled={disabled}
                    active={Boolean(active?.ruby)}
                    aria-label={disabled ? t("story.richText.rubyHint") : t("story.richText.ruby")}
                    data-tip={disabled ? t("story.richText.rubyHint") : t("story.richText.ruby")}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setRuby(current => (current ? null : anchorOf(rubyButtonRef.current)))}
                >
                    <Superscript className="h-3.5 w-3.5" />
                </ToolbarButton>
            </TooltipGroup>
            {type ? (
                <TypePopover
                    anchor={type}
                    anchorRef={typeButtonRef}
                    omitSpeed
                    target={{
                        start: selection.start,
                        end: selection.end,
                        emphasis: active?.emphasis,
                        fontSizeStep: active?.fontSizeStep,
                    }}
                    onSet={(mark, value, range) => {
                        if (mark === "emphasis") {
                            setMark("emphasis", (value as UITextRunMarks["emphasis"]) ?? undefined, range);
                            return;
                        }
                        if (mark === "fontSizeStep") {
                            setMark("fontSizeStep", typeof value === "number" ? value : undefined, range);
                        }
                    }}
                    onClose={() => setType(null)}
                />
            ) : null}
            {ruby ? (
                <RubyPopover
                    anchor={ruby}
                    anchorRef={rubyButtonRef}
                    value={active?.ruby}
                    onCommit={value => setMark("ruby", value ?? undefined, selection)}
                    onRemove={() => {
                        setMark("ruby", undefined, selection);
                        setRuby(null);
                    }}
                    onClose={() => setRuby(null)}
                />
            ) : null}
        </div>
    );
}
