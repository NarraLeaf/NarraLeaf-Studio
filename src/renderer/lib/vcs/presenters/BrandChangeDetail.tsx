import { useMemo } from "react";
import type { TranslationKey } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { GenericChangeDetail } from "./GenericChangeDetail";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { useSideBytes, type ComparisonSide, type SideBytesStatus } from "./comparisonSide";
import { sidesOfEntry } from "./entrySides";
import { comparePalettes, isBrandEntry, readPalette, type SwatchRow, type SwatchSide } from "./brandPalette";

/**
 * The project's palette, before and after, in two columns.
 *
 * A colour is the one kind of value that cannot be read: `#3E6B7A` and `#3E7B6A` differ by one
 * character and by nothing an author can picture, and the change list can only ever show them as
 * text. Two swatches beside each other answer in one glance what the two strings cannot answer at
 * all.
 *
 * **Every swatch has a border.** Half of a palette is near the background at any given moment, in
 * one theme or the other, and a borderless block of `#0F1115` on `bg-surface` is not a swatch, it
 * is a gap.
 */

export function BrandChangeDetail({ entry, change, sides }: ChangePresenterProps) {
    const { t } = useTranslation();
    const requested = useMemo(() => sidesOfEntry(entry, sides), [entry, sides]);
    const before = usePaletteSide(requested.before, entry.path);
    const after = usePaletteSide(requested.after, entry.path);

    const comparison = useMemo(
        () => comparePalettes(before.colors, after.colors),
        [before.colors, after.colors],
    );
    const settled = isSettled(before) && isSettled(after);
    /**
     * A side the comparison expects to hold a palette and that did not produce one.
     *
     * **Either side missing takes the whole table down**, which is not what the image and sound
     * presenters do, and the difference is in the shape: those draw one frame per side, so an
     * unreadable side is a frame with a reason in it. Here the two sides are merged into rows, and
     * a missing older side would come out as every colour in the file being newly added.
     */
    const unreadable = missingSide(requested.after, after) ?? missingSide(requested.before, before);

    if (settled && unreadable) {
        return (
            <div className="flex flex-col gap-2">
                <p className="text-2xs text-fg-muted">{t(failureKey(unreadable))}</p>
                <GenericChangeDetail entry={entry} change={change} />
            </div>
        );
    }

    if (!settled) {
        return <p className="py-1 text-2xs text-fg-muted">{t("documentDiff.rows.loading")}</p>;
    }

    return (
        <div className="flex flex-col gap-2 py-1">
            <div className="grid grid-cols-[minmax(5rem,auto)_1fr_1fr] items-center gap-x-3 gap-y-1">
                <span />
                <span className="text-2xs text-fg-subtle">{t("documentDiff.presenter.before")}</span>
                <span className="text-2xs text-fg-subtle">{t("documentDiff.presenter.after")}</span>
                {comparison.rows.map(row => <Row key={row.id} row={row} />)}
            </div>
            {/* Stated rather than left out: a palette carries seventeen seeded entries, and a list
                of two rows with nothing said about the rest reads as a comparison that stopped. */}
            {comparison.unchanged > 0 && (
                <p className="text-2xs text-fg-subtle">
                    {comparison.unchanged === 1
                        ? t("documentDiff.presenter.brand.unchangedOne")
                        : t("documentDiff.presenter.brand.unchangedMany", { count: comparison.unchanged })}
                </p>
            )}
        </div>
    );
}

function Row({ row }: { row: SwatchRow }) {
    const { t } = useTranslation();
    return (
        <>
            <span className="truncate font-mono text-2xs text-fg-muted" data-tip={row.id}>{row.id}</span>
            <Cell side={row.before} absent="documentDiff.presenter.brand.added" />
            <Cell
                side={row.after}
                absent="documentDiff.presenter.brand.removed"
                tinted={row.state === "changed"}
            />
        </>
    );
}

/**
 * One side of one row.
 *
 * `absent` is the word for the cell that has no entry at all, and the two are the other way round
 * from what they look like: the empty cell on the OLDER side means the colour was added, and the
 * empty one on the newer side means it was removed.
 */
function Cell({
    side,
    absent,
    tinted = false,
}: {
    side: SwatchSide | null;
    absent: TranslationKey;
    tinted?: boolean;
}) {
    const { t } = useTranslation();
    if (!side) {
        return <span className="text-2xs text-fg-subtle">{t(absent)}</span>;
    }
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {side.css
                ? (
                    <span
                        aria-hidden
                        // `edge-strong` and not `edge`: this border is the only thing separating a
                        // near-background colour from the panel it sits on.
                        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-edge-strong"
                        style={{ backgroundColor: side.css }}
                    />
                )
                : <span className="shrink-0 text-2xs text-fg-subtle">{t("documentDiff.presenter.brand.unresolved")}</span>}
            <span className={cn("truncate font-mono text-2xs", tinted ? "text-warning" : "text-fg-muted")}>
                {side.value}
            </span>
            {side.name && <span className="truncate text-2xs text-fg-subtle">{side.name}</span>}
        </span>
    );
}

/* ---------------------------------------------------------------------------------------- */
/* Reading one side                                                                           */
/* ---------------------------------------------------------------------------------------- */

interface PaletteSide {
    readonly status: SideBytesStatus;
    /** The entries this side stores, or null while there are none to show. */
    readonly colors: ReturnType<typeof readPalette>;
    /** True when the bytes arrived and were not a palette. */
    readonly broken: boolean;
}

function usePaletteSide(side: ComparisonSide | null, path: string): PaletteSide {
    const read = useSideBytes(side, path);
    const colors = useMemo(() => (read.value ? readPalette(read.value) : null), [read.value]);
    return { status: read.status, colors, broken: read.status === "ready" && colors === null };
}

/* ---------------------------------------------------------------------------------------- */
/* Words                                                                                      */
/* ---------------------------------------------------------------------------------------- */

/**
 * Why one side produced no palette.
 *
 * Three facts and they stay three: a file past the ceiling, bytes that are not a palette, and a
 * read that has not finished.
 */
function failureKey(side: PaletteSide): TranslationKey {
    if (side.status === "tooLarge") return "documentDiff.presenter.brand.tooLarge";
    if (side.status === "failed" || side.status === "unsupported" || side.broken) {
        return "documentDiff.presenter.brand.unreadable";
    }
    return "documentDiff.rows.loading";
}

/** Whether this side has finished trying. Parsing is synchronous, so `ready` really is the end. */
function isSettled(side: PaletteSide): boolean {
    return side.status !== "loading";
}

/** The side, when the comparison expects a palette from it and did not get one. */
function missingSide(requested: ComparisonSide | null, side: PaletteSide): PaletteSide | null {
    return requested !== null && !side.colors ? side : null;
}

export const brandChangePresenter: ChangePresenter = {
    id: "brand",
    matches: isBrandEntry,
    Detail: BrandChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`. A presenter that is
// only exported is a presenter nobody ever sees.
registerChangePresenter(brandChangePresenter);
