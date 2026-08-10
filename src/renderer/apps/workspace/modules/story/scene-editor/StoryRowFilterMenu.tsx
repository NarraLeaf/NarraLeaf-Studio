import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { Character } from "@/lib/workspace/services/character/Character";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { characterIdentity } from "./StoryRowGutter";
import { useCharacterAvatar } from "./storyCharacterFace";
import { characterSpeakerIdentity, storySpeakerInitial, storySpeakerPaint, type StorySpeakerIdentity } from "./storySpeakerIdentity";
import {
    EMPTY_STORY_ROW_FILTER,
    isDialogueOnlyStoryRowFilter,
    isStoryRowFilterActive,
    dialogueOnlyStoryRowFilter,
    storyRowFacetColor,
    storyRowFacetIcon,
    storyRowFacetLabelKey,
    STORY_ROW_NARRATIVE_FACETS,
    STORY_ROW_STAGING_FACETS,
    type StoryRowFacetId,
    type StoryRowFilter,
    type StoryRowSpeakerKey,
    type StoryRowTallies,
} from "./storyRowFilter";

const PANEL_WIDTH = 236;
/** Roughly the panel's natural height with a small cast — what it is pushed up by. */
const PANEL_MAX_HEIGHT = 560;
/** How close the panel may come to the window edge before it starts scrolling its own list. */
const VIEWPORT_MARGIN = 8;
/**
 * The mark beside a cast member. Smaller than the gutter's 26px plate — this is a menu row — but the
 * same 20px a face gets in the `/` menu's candidate list, which is the smallest a head crop stays
 * recognisable at. It still fits the row's 24px line box, so the cast rows and the facet rows above
 * them keep the identical height.
 */
const CAST_MARK_PX = 20;

/**
 * One row of the filter, ticked when the author has picked it out.
 *
 * The icon leads and the tick trails, so the glyphs — which are what the eye actually scans this list
 * by — run flush down the left edge instead of being indented past a column that is empty on every
 * row nobody has picked. Both end slots are reserved, so ticking never shifts the label or the count:
 * a list that re-flows under the pointer is a list you cannot tick three things in.
 *
 * Nothing is dimmed for being unticked, which is the whole point of positive selection: an untouched
 * panel is the ordinary state and has to LOOK ordinary, or thirteen greyed rows would read as
 * thirteen things switched off.
 *
 * The one thing that does read as quiet is a row with no rows behind it (count 0). It stays in place
 * rather than disappearing — the menu is the same shape in every scene, and a row that vanishes when
 * it is empty is one the author has to go looking for the moment the scene grows one.
 */
function FilterRow(props: { label: string; count: number; selected: boolean; mark: ReactNode; onToggle: () => void }) {
    const empty = props.count === 0;
    return (
        <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={props.selected}
            onClick={props.onToggle}
            className={[
                "flex w-full shrink-0 cursor-default items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                props.selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-fill",
            ].join(" ")}
        >
            {/* The icons start the row — one slot for both kinds of mark, sized to the larger (a cast
                face), so a facet's glyph and a character's portrait line up down the left edge and
                every label starts at the same x. A reserved tick column in front of them would push
                the whole list in by a column that is blank on most rows. */}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {props.mark}
            </span>
            <span className={["min-w-0 truncate", empty ? "text-fg-subtle" : props.selected ? "text-primary" : "text-fg"].join(" ")}>
                {props.label}
            </span>
            {/* The count sits with its label rather than in a column of its own: "对话 4" reads as one
                phrase, where a number parked at the far edge has to be tracked back across the row to
                find out what it counts. Quieter than the label, so the list still scans as names. */}
            <span className={["shrink-0 tabular-nums", empty ? "text-fg-subtle/60" : "text-fg-subtle"].join(" ")}>
                {props.count}
            </span>
            {/* The tick trails the row rather than leading it, and its slot is reserved on every row so
                nothing shifts when one is ticked. It is the least of the three signals a selected row
                carries (fill, ink, tick), which is why it can afford the quieter end. */}
            <span className="ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {props.selected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
            </span>
        </button>
    );
}

/**
 * A cast member's mark: their face when the project has one, their colour disc when it does not.
 *
 * The same two-state treatment the gutter gives a speaker, at menu scale — a list of faces beside the
 * scene's own faces is how you pick a name out of it without reading; a column of coloured letters is
 * a legend you have to decode. `preferThumbnail`, because this list asks "who is this" rather than
 * "what do they look like right now": the avatar the author chose answers that better than a head
 * cropped out of whichever sprite the scene last put on stage.
 *
 * Both states are SOLID and both wear the character's own colour (gutter 规范 §3.1, §3.3) — the disc
 * as its fill, the portrait as its hairline. A face too small to recognise still says whose it is.
 */
function CastMark(props: { identity: StorySpeakerIdentity; character: Character | null }) {
    const paint = storySpeakerPaint(props.identity.paint);
    // `resolveVariant` still on under `preferThumbnail`: the thumbnail short-circuits the sprite
    // resolve when there is one, and when there is not, a head cropped from the character's default
    // sprite is a face — falling straight to the disc would blank half a cast nobody has drawn an
    // avatar for. Same pair the `/` menu's candidate list asks for, for the same reason.
    const { url, frame, showingSprite } = useCharacterAvatar(props.character, { resolveVariant: true, preferThumbnail: true });
    if (url) {
        return (
            <span
                className={`${paint.className} block shrink-0 overflow-hidden rounded-full bg-fill-subtle`}
                style={{
                    ...paint.style,
                    width: CAST_MARK_PX,
                    height: CAST_MARK_PX,
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "var(--nl-speaker-disc)",
                }}
            >
                {showingSprite
                    ? <HeadThumbnail url={url} alt="" frame={frame} className="h-full w-full" iconClassName="h-2 w-2" />
                    : <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />}
            </span>
        );
    }
    return (
        <span
            className={`${paint.className} flex shrink-0 select-none items-center justify-center rounded-full font-medium leading-none`}
            style={{
                ...paint.style,
                width: CAST_MARK_PX,
                height: CAST_MARK_PX,
                fontSize: 9,
                backgroundColor: "var(--nl-speaker-disc)",
                color: "var(--nl-speaker-ink)",
            }}
        >
            {storySpeakerInitial(props.identity.name)}
        </span>
    );
}

/**
 * The row filter's panel: tick what you want to see, and only that.
 *
 * Positive selection, so **nothing ticked is the ordinary state and shows everything**. The ticks are
 * the filter, which is the whole of what an author has to read off the panel; the alternative — every
 * box ticked by default, and unticking to hide — makes "unfiltered" a state you have to count to
 * recognise, and makes an empty page look like a bug rather than like the two ticks that caused it.
 *
 * A popover rather than a `ContextMenu`, for one reason — every other menu in the editor performs an
 * action and closes, and this one is a set of switches an author flips two or three of in a row. It
 * writes on every click (no Apply), so the page behind it is always showing what the ticks say.
 *
 * The first two sections are the same cut "narrative only" always made: the words that get performed,
 * and the machinery that stages them. The preset at the top is that split as one click. The third is
 * the cast, which is a different question about the same rows — whose scene is this — and is why the
 * filter has two axes rather than one longer list: ticking 对话 and ticking Nattou means her dialogue,
 * not one of the two.
 */
export function StoryRowFilterMenu(props: {
    anchor: { left: number; right: number; bottom: number };
    /**
     * The button that opened the panel. Excluded from the light dismiss, because otherwise a click on
     * it closes the panel here and re-opens it in the button's own handler — the panel would never
     * shut from the control that owns it.
     */
    anchorEl: HTMLElement | null;
    filter: StoryRowFilter;
    tallies: StoryRowTallies;
    characters: Character[];
    onChange: (filter: StoryRowFilter) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    // Light dismiss, matching the editor's other popovers: any pointerdown outside closes, and the
    // event still reaches whatever was clicked so the toolbar button's own toggle stays a toggle.
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panelRef.current?.contains(target) || props.anchorEl?.contains(target)) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const toggleFacet = (facet: StoryRowFacetId) => {
        const facets = new Set(props.filter.facets);
        if (facets.has(facet)) {
            facets.delete(facet);
        } else {
            facets.add(facet);
        }
        props.onChange({ ...props.filter, facets });
    };

    const toggleSpeaker = (key: StoryRowSpeakerKey) => {
        const speakers = new Set(props.filter.speakers);
        if (speakers.has(key)) {
            speakers.delete(key);
        } else {
            speakers.add(key);
        }
        props.onChange({ ...props.filter, speakers });
    };

    // A cast member's name and colour come from the project, not from the tally: the tally counts rows
    // and knows only ids. Same `characterIdentity` the gutter and the nametag ask, so one character is
    // one colour here too; a temp speaker takes the hue their own name hashes to, exactly as in a row.
    const cast = useMemo(() => props.tallies.speakers.map(tally => ({
        key: tally.key,
        count: tally.count,
        // Null for a temp speaker: there is no `Character` to take a face off, so the disc is the
        // whole of their mark — which is also true of them in the gutter.
        character: tally.characterId
            ? props.characters.find(candidate => candidate.profile.getId() === tally.characterId) ?? null
            : null,
        identity: tally.characterId
            ? characterIdentity(tally.characterId, props.characters)
            : characterSpeakerIdentity(tally.name, { hasPortrait: false }),
    })), [props.characters, props.tallies.speakers]);

    const dialogueOnly = isDialogueOnlyStoryRowFilter(props.filter);
    const active = isStoryRowFilterActive(props.filter);
    // Right-aligned to the button: it is the last-but-two control on a right-hand toolbar, so opening
    // leftwards is the only placement that does not hang the panel off the edge of a narrow editor.
    const left = Math.max(VIEWPORT_MARGIN, Math.min(props.anchor.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN));
    const top = Math.min(props.anchor.bottom + 6, Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_MAX_HEIGHT));
    // In a window too short to hold the whole list the panel scrolls rather than running off the
    // bottom — thirteen facets plus a cast is more than a half-height editor has room for.
    const maxHeight = Math.max(120, window.innerHeight - top - VIEWPORT_MARGIN);

    const sections: { key: string; label: string; facets: readonly StoryRowFacetId[] }[] = [
        { key: "script", label: t("story.view.filter.sectionScript"), facets: STORY_ROW_NARRATIVE_FACETS },
        { key: "staging", label: t("story.view.filter.sectionStaging"), facets: STORY_ROW_STAGING_FACETS },
    ];

    return createPortal(
        <div
            ref={panelRef}
            role="menu"
            aria-label={t("story.view.filter.title")}
            className="fixed z-[70] flex flex-col gap-1 overflow-y-auto rounded-lg border border-edge bg-surface-raised p-1.5 shadow-2xl"
            style={{ top, left, width: PANEL_WIDTH, maxHeight }}
            onMouseDown={event => event.stopPropagation()}
        >
            {/* The preset, then the way out. Clear is disabled rather than hidden while there is
                nothing to clear: a control that appears the moment it becomes useful is one the author
                has to notice arriving, and this one is the answer to "how do I get my page back". */}
            <div className="flex shrink-0 items-center gap-1 px-0.5">
                <button
                    type="button"
                    onClick={() => props.onChange(dialogueOnlyStoryRowFilter())}
                    className={[
                        "flex-1 cursor-default rounded-md px-2 py-1 text-2xs transition-colors",
                        dialogueOnly ? "bg-primary/15 text-primary" : "bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
                    ].join(" ")}
                >
                    {t("story.view.filter.dialogueOnly")}
                </button>
                <button
                    type="button"
                    onClick={() => props.onChange(EMPTY_STORY_ROW_FILTER)}
                    disabled={!active}
                    className="flex-1 cursor-default rounded-md bg-fill-subtle px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:bg-transparent disabled:text-fg-subtle/60 disabled:hover:bg-transparent"
                >
                    {t("story.view.filter.clear")}
                </button>
            </div>
            {sections.map(section => (
                // `contents` so the section's rows stay direct children of the panel's flex column —
                // a wrapper box here would give the list a second scroll context to compress inside.
                <div key={section.key} className="contents">
                    <div className="my-0.5 h-px shrink-0 bg-edge" />
                    <div className="shrink-0 px-2 pb-0.5 text-2xs font-medium text-fg-subtle">{section.label}</div>
                    {section.facets.map(facet => {
                        const Icon = storyRowFacetIcon(facet);
                        return (
                            <FilterRow
                                key={facet}
                                label={t(storyRowFacetLabelKey(facet))}
                                count={props.tallies.facets[facet]}
                                selected={props.filter.facets.has(facet)}
                                mark={<Icon className="h-3.5 w-3.5" style={{ color: storyRowFacetColor(facet) }} />}
                                onToggle={() => toggleFacet(facet)}
                            />
                        );
                    })}
                </div>
            ))}
            {cast.length > 0 ? (
                <>
                    <div className="my-0.5 h-px shrink-0 bg-edge" />
                    <div className="shrink-0 px-2 pb-0.5 text-2xs font-medium text-fg-subtle">{t("story.view.filter.sectionCast")}</div>
                    {cast.map(member => (
                        <FilterRow
                            key={member.key}
                            label={member.identity.name}
                            count={member.count}
                            selected={props.filter.speakers.has(member.key)}
                            mark={<CastMark identity={member.identity} character={member.character} />}
                            onToggle={() => toggleSpeaker(member.key)}
                        />
                    ))}
                </>
            ) : null}
        </div>,
        globalThis.document.body,
    );
}
