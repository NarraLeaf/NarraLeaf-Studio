import { AlertTriangle, Bookmark, UserRound, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { Combination, CombinationSet } from "@/lib/workspace/services/character/characterCombinations";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";

const CELL_PX = 160;

function Cell(props: {
    character: Character;
    combination: Combination;
    active: boolean;
    /** True when this look has a hand-drawn avatar rather than a baked one. */
    overridden: boolean;
    onPick: () => void;
    onName: () => void;
    onAvatar: (anchor: HTMLElement) => void;
}) {
    const { t } = useTranslation();
    // Picking a cell only moves the preview onto that look, so the tile stays clickable while frozen -
    // browsing the grid is what a past version is opened for. Naming the look stores a snapshot on the
    // appearance and giving it an avatar opens a picker that writes one, so both are off.
    const freeze = useFreezeGuard();
    const { url } = useCompositedSprite(props.character, { tags: props.combination.tags }, CELL_PX);
    const { combination } = props;
    return (
        <div
            className={[
                "group/cell relative flex flex-col gap-1 rounded-md border p-1.5 text-2xs transition-colors",
                props.active ? "border-primary/60 bg-primary/10" : "border-edge hover:bg-fill-subtle",
            ].join(" ")}
        >
            <button className="relative block h-24 w-full" onClick={props.onPick}>
                {url
                    ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
                    : <span className="grid h-full w-full place-items-center rounded-sm bg-fill" />}
            </button>
            <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-fg-muted">{combination.labels.join(" · ")}</span>
                {combination.missing.length > 0 && (
                    <AlertTriangle
                        className="h-3 w-3 shrink-0 text-warning"
                        aria-label={t("characters.editor.combinations.missing", { list: combination.missing.join(", ") })}
                    />
                )}
                <button
                    className="hidden shrink-0 rounded-md p-0.5 text-fg-muted hover:text-fg group-hover/cell:block"
                    aria-label={t("characters.editor.combinations.name")}
                    onClick={props.onName}
                    {...freeze.writes(false, t("characters.editor.combinations.name"))}
                >
                    <Bookmark className="h-3 w-3" />
                </button>
                <button
                    className={[
                        "shrink-0 rounded-md p-0.5 hover:text-fg",
                        props.overridden ? "block text-primary" : "hidden text-fg-muted group-hover/cell:block",
                    ].join(" ")}
                    aria-label={t("characters.editor.avatar")}
                    onClick={event => props.onAvatar(event.currentTarget)}
                    {...freeze.writes(false, t("characters.editor.avatar"))}
                >
                    <UserRound className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

/**
 * Every look the stack can strike, composited.
 *
 * This is the first surface that answers "how many differentials does this character actually have",
 * and the only one that shows the gaps: a cell whose warning triangle is lit has a layer with art
 * under other tags and none under these.
 *
 * The count in the header is `shown / total`, because the grid is capped — a truncated grid that did
 * not say so would read as a complete inventory.
 */
export function CombinationGrid(props: {
    character: Character;
    set: CombinationSet;
    activeKey: string | null;
    /** Avatar keys whose look the author gave their own artwork. */
    overriddenAvatarKeys: ReadonlySet<string>;
    avatarKeyOf: (combination: Combination) => string | null;
    onPick: (combination: Combination) => void;
    onName: (combination: Combination) => void;
    onAvatar: (combination: Combination, anchor: HTMLElement) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const { combinations, total } = props.set;
    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b border-edge px-4 py-2 text-xs text-fg-muted">
                <span>{combinations.length === total ? `${total}` : `${combinations.length} / ${total}`}</span>
                <span className="truncate">{props.set.axisNames.join(" × ")}</span>
                <button
                    className="ml-auto rounded-md p-1 hover:bg-fill hover:text-fg"
                    aria-label={t("common.close")}
                    onClick={props.onClose}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 overflow-y-auto p-3">
                {combinations.length === 0 ? (
                    <div className="col-span-full grid place-items-center p-6 text-sm text-fg-subtle">
                        {t("characters.preview.placeholder")}
                    </div>
                ) : combinations.map(combination => (
                    <Cell
                        key={combination.key}
                        character={props.character}
                        combination={combination}
                        active={combination.key === props.activeKey}
                        overridden={props.overriddenAvatarKeys.has(props.avatarKeyOf(combination) ?? "")}
                        onPick={() => props.onPick(combination)}
                        onName={() => props.onName(combination)}
                        onAvatar={anchor => props.onAvatar(combination, anchor)}
                    />
                ))}
            </div>
        </div>
    );
}
