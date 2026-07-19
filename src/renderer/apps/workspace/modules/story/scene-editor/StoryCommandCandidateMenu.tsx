import { useEffect, useRef, useState } from "react";
import { Hash } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * The candidate list for a command-line *argument* — an asset, a scene, a transition, a param name.
 *
 * The command name keeps its own menu (`ActionCommandMenu`, with its category tabs) and the speaker
 * keeps `CharacterPicker`; this is only for the positions those two never covered. It deliberately
 * mirrors `CharacterPicker`'s shape — same surface, same row metrics, same active treatment — so the
 * slot looks like one menu that changes its contents as the caret moves, not three menus.
 */

/** Structurally identical to the rows file's own placement type; declared here to avoid an import cycle. */
type PopupPlacement = "above" | "below";

export type StoryCandidateItem = {
    /** Stable within one list. Values are not unique on their own (two assets may share a name). */
    key: string;
    /** The text a completion inserts. */
    value: string;
    label: string;
    /** Trailing note: a variable's type, the canonical value behind an alias. */
    detail?: string;
    icon?: typeof Hash;
    iconClassName?: string;
    /** Right-aligned tag, e.g. a temp speaker's "name only". */
    tag?: string;
    /**
     * This entry is the author's own text offered back, matching nothing (a temp speaker, an object
     * created in another scene). Carried through from the candidate rather than collapsed into `tag`
     * because it also decides the highlight: taking a free echo and submitting the line produce the
     * same block, so Enter should submit. See `defaultHighlights`.
     */
    free?: true;
};

/**
 * Which item Enter would take.
 *
 * `autoHighlight` carries the interaction model's rule down to the list: must-pick positions start on
 * their first item, optional-next-step positions start on nothing so Enter submits the line instead of
 * grabbing a candidate. An arrow key creates a highlight where there was none.
 */
export function useStoryCandidateMenuState(items: StoryCandidateItem[], autoHighlight: boolean) {
    const [activeKey, setActiveKey] = useState<string | null>(null);

    useEffect(() => {
        setActiveKey(current => {
            if (current && items.some(item => item.key === current)) {
                return current;
            }
            return autoHighlight ? items[0]?.key ?? null : null;
        });
    }, [autoHighlight, items]);

    const activeItem = items.find(item => item.key === activeKey) ?? null;

    const move = (direction: -1 | 1) => {
        if (items.length === 0) {
            return;
        }
        if (!activeItem) {
            setActiveKey(items[direction === 1 ? 0 : items.length - 1].key);
            return;
        }
        const currentIndex = items.findIndex(item => item.key === activeItem.key);
        setActiveKey(items[(currentIndex + direction + items.length) % items.length].key);
    };

    return { activeItem, selectItem: setActiveKey, move };
}

export function StoryCommandCandidateMenu(props: {
    items: StoryCandidateItem[];
    activeKey: string | null;
    onHighlight: (key: string) => void;
    onChoose: (item: StoryCandidateItem) => void;
    onCancel: () => void;
    placement: PopupPlacement;
}) {
    const { t } = useTranslation();
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!props.activeKey) {
            return;
        }
        window.requestAnimationFrame(() => {
            const active = listRef.current?.querySelector(`[data-candidate-key="${CSS.escape(props.activeKey ?? "")}"]`);
            active?.scrollIntoView({ block: "nearest" });
        });
    }, [props.activeKey]);

    return (
        <div
            ref={listRef}
            className={[
                "absolute left-0 z-50 max-h-72 w-[320px] overflow-auto rounded-xl border border-edge bg-surface-raised p-1 shadow-xl",
                props.placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
            ].join(" ")}
            role="listbox"
            onMouseDown={event => {
                // Keep the caret in the slot: the menu is an extension of the line being typed.
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.items.length === 0 ? (
                <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onCancel}>
                    {t("story.rows.noCandidates")}
                </button>
            ) : (
                props.items.map(item => {
                    const active = item.key === props.activeKey;
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-candidate-key={item.key}
                            className={[
                                "flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors",
                                active ? "bg-primary/15 text-fg" : "hover:bg-fill",
                            ].join(" ")}
                            onMouseEnter={() => props.onHighlight(item.key)}
                            onMouseDown={() => props.onChoose(item)}
                        >
                            {Icon ? <Icon className={["h-4 w-4 shrink-0", item.iconClassName ?? (active ? "text-fg-muted" : "text-fg-subtle")].join(" ")} /> : null}
                            <span className="truncate text-sm text-fg">{item.label}</span>
                            {item.detail ? <span className="shrink-0 text-2xs text-fg-subtle">{item.detail}</span> : null}
                            {item.tag ? <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{item.tag}</span> : null}
                        </button>
                    );
                })
            )}
        </div>
    );
}
