import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { SearchService } from "@/lib/workspace/services/search/SearchService";
import { QuickSwitchOverlay, type QuickListRow } from "./QuickSwitchOverlay";
import { clampIndex, rankFuzzyList, wrapIndex } from "./fuzzyListModel";
import { collectQuickOpenEntries, QUICK_OPEN_KIND_LABEL_KEYS, type QuickOpenEntry } from "./quickOpenModel";

const MAX_ROWS = 50;

/**
 * Quick Open (mod+p): a fuzzy picker over everything openable — story scenes, characters, UI
 * surfaces, assets, and blueprints — gathered from the live registries when the picker opens.
 * Enter opens the entity through the same tab creators its panel uses (EditorService.open under
 * the hood). Shares the floating overlay with the editor quick switch; content-text search stays
 * in the title-bar box / search panel.
 */
export function QuickOpenPicker() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [entries, setEntries] = useState<QuickOpenEntry[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useKeybinding({
        id: "workspace-quick-open",
        key: "mod+p",
        description: "Quick open (scenes, assets, surfaces…)",
        handler: () => setOpen(previous => !previous),
        allowInEditable: true,
    });

    // Snapshot the openable entities each time the picker opens. Story documents may still be
    // loading on first use — ensureReady (shared with search) loads them, then we re-collect.
    useEffect(() => {
        if (!open || !context) {
            return;
        }
        let mounted = true;
        setEntries(collectQuickOpenEntries(context));
        const searchService = context.services.get<SearchService>(Services.Search);
        void searchService.ensureReady().then(() => {
            if (mounted) {
                setEntries(collectQuickOpenEntries(context));
            }
        });
        return () => {
            mounted = false;
        };
    }, [open, context]);

    useEffect(() => {
        if (open) {
            setQuery("");
            setSelectedIndex(0);
            const frame = requestAnimationFrame(() => inputRef.current?.focus());
            return () => cancelAnimationFrame(frame);
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleBlur = () => setOpen(false);
        window.addEventListener("blur", handleBlur);
        return () => window.removeEventListener("blur", handleBlur);
    }, [open]);

    const ranked = useMemo(
        () => rankFuzzyList(entries, query, entry => [entry.title, entry.detail ?? ""]).slice(0, MAX_ROWS),
        [entries, query],
    );

    useEffect(() => {
        setSelectedIndex(index => clampIndex(index, ranked.length));
    }, [ranked.length]);

    const close = useCallback(() => setOpen(false), []);

    const commit = useCallback(
        (index: number) => {
            const entry = ranked[index]?.item;
            setOpen(false);
            if (entry && context) {
                entry.open(context);
            }
        },
        [ranked, context],
    );

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            const handled = () => {
                event.preventDefault();
                event.stopPropagation();
            };
            switch (event.key) {
                case "ArrowDown":
                    handled();
                    setSelectedIndex(index => wrapIndex(index + 1, ranked.length));
                    break;
                case "ArrowUp":
                    handled();
                    setSelectedIndex(index => wrapIndex(index - 1, ranked.length));
                    break;
                case "Enter":
                    handled();
                    commit(selectedIndex);
                    break;
                case "Escape":
                    handled();
                    close();
                    break;
                default:
                    break;
            }
        },
        [ranked.length, selectedIndex, commit, close],
    );

    if (!open) {
        return null;
    }

    const rows: QuickListRow[] = ranked.map(({ item, positions }) => ({
        key: item.key,
        icon: item.icon,
        title: (
            <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate">
                    {positions.length === 0
                        ? item.title
                        : Array.from(item.title).map((char, index) =>
                              positions.includes(index) ? (
                                  <span key={index} className="font-semibold text-fg">
                                      {char}
                                  </span>
                              ) : (
                                  char
                              ),
                          )}
                </span>
                {item.detail && <span className="shrink-0 text-xs text-fg-subtle">{item.detail}</span>}
            </span>
        ),
        trailing: t(QUICK_OPEN_KIND_LABEL_KEYS[item.kind]),
    }));

    return (
        <QuickSwitchOverlay
            zClassName="z-[46]"
            rows={rows}
            selectedIndex={selectedIndex}
            onCommit={commit}
            onHoverIndex={setSelectedIndex}
            ariaLabel={t("workspace.shell.quickOpen.title")}
            emptyText={query.trim() ? t("workspace.shell.quickOpen.empty") : t("workspace.shell.quickOpen.placeholder")}
            search={{
                value: query,
                placeholder: t("workspace.shell.quickOpen.placeholder"),
                ariaLabel: t("workspace.shell.quickOpen.title"),
                onChange: setQuery,
                onKeyDown: handleKeyDown,
                inputRef,
            }}
        />
    );
}
