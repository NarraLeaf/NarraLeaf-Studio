import { useEffect, useMemo, useState } from "react";
import type { DocumentChangeKind } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { formatBytes } from "../documentChangeView";
import { GenericChangeDetail } from "./GenericChangeDetail";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { useSideBytes, type ComparisonSide, type SideBytesStatus } from "./comparisonSide";
import { sidesOfEntry } from "./entrySides";
import {
    DEFAULT_FONT_SAMPLE_SIZE,
    FONT_SAMPLE_SIZES,
    isFontEntry,
    nextFontFamily,
} from "./fontPreview";

/**
 * The same words, set in both versions of a typeface.
 *
 * What a comparison could say about a font before this was its family name and its size, and
 * neither is what an author replaced it for: a hinting pass, a re-export that dropped half the
 * glyph set, a weight swapped for the wrong one. All three are invisible in a change row and
 * unmistakable in a line of text.
 *
 * **One specimen, at one size, set twice.** Both sides take the size from the same control, so a
 * difference on screen is a difference in the file rather than in how it was drawn.
 *
 * **The specimen carries Chinese as well as Latin.** A font installed into a project of this kind
 * is usually there to set Chinese, and a Latin pangram cannot show whether the Chinese glyphs came
 * with it: with none in the file the browser quietly draws them from a system face, and both sides
 * look correct. The two scripts side by side make that visible.
 */

export function FontChangeDetail({ entry, change, sides }: ChangePresenterProps) {
    const { t } = useTranslation();
    const requested = useMemo(() => sidesOfEntry(entry, sides), [entry, sides]);
    const before = useFontSide(requested.before, entry.path);
    const after = useFontSide(requested.after, entry.path);
    const [size, setSize] = useState(DEFAULT_FONT_SAMPLE_SIZE);

    const settled = isSettled(before) && isSettled(after);
    if (settled && !before.family && !after.family) {
        return (
            <div className="flex flex-col gap-2">
                <p className="text-2xs text-fg-muted">{t(failureKey(before, after))}</p>
                <GenericChangeDetail entry={entry} change={change} />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 py-1">
            <div
                role="group"
                aria-label={t("documentDiff.presenter.font.sizeLabel")}
                className="inline-flex self-start divide-x divide-edge overflow-hidden rounded-md border border-edge"
            >
                {FONT_SAMPLE_SIZES.map(option => (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={option === size}
                        onClick={() => setSize(option)}
                        className={cn(
                            // `nl-focus-ring` rather than a ring utility: `styles.css` clears
                            // box-shadow on every focused native control, so a `focus:ring-*` here
                            // would be dead code.
                            "nl-focus-ring min-h-7 px-2 py-1 text-2xs transition-colors",
                            option === size ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                        )}
                    >
                        {option}
                    </button>
                ))}
            </div>

            {requested.before !== null && (
                <Specimen side={before} size={size} caption={sideCaption(entry.kind, "before")} />
            )}
            {/* One side, and no empty box beside it pretending there is something to compare. */}
            {requested.after !== null && (
                <Specimen side={after} size={size} caption={sideCaption(entry.kind, "after")} />
            )}
        </div>
    );
}

function Specimen({
    side,
    size,
    caption,
}: {
    side: FontSide;
    size: number;
    caption: TranslationKey | null;
}) {
    const { t } = useTranslation();
    return (
        <figure className="flex min-w-0 flex-col gap-1">
            <div className="min-h-16 overflow-hidden rounded-md border border-edge bg-surface-sunken px-3 py-2">
                {side.family
                    ? (
                        <p
                            // The size is a number from a fixed list rather than a class, because
                            // the point of the control is that both sides move together and a
                            // utility class per step would be four classes saying one thing.
                            style={{ fontFamily: side.family, fontSize: `${size}px`, lineHeight: 1.4 }}
                            className="break-words text-fg"
                        >
                            {t("documentDiff.presenter.font.sample")}
                        </p>
                    )
                    : <p className="text-2xs text-fg-muted">{t(stateKey(side))}</p>}
            </div>
            <figcaption className="truncate text-2xs text-fg-subtle">
                {/* No size for a side that was never read: `formatBytes(0)` says "0 B", which of a
                    file that is too large to hand over is the opposite of the truth. */}
                {[caption ? t(caption) : null, side.size > 0 ? formatBytes(side.size) : null]
                    .filter(Boolean)
                    .join(" · ")}
            </figcaption>
        </figure>
    );
}

/* ---------------------------------------------------------------------------------------- */
/* Loading one side                                                                           */
/* ---------------------------------------------------------------------------------------- */

interface FontSide {
    readonly status: SideBytesStatus;
    readonly size: number;
    /** The family this side is installed under, or null while it is not. */
    readonly family: string | null;
    /** True when the bytes arrived and the font system would not take them. */
    readonly broken: boolean;
}

/**
 * One side's bytes, installed as a face nothing else refers to.
 *
 * **Every face this adds is removed again.** `document.fonts` is the document's, not this pane's:
 * a face left behind outlives the comparison, and an author working through a folder of type would
 * accumulate one per file for as long as the window is open. The cleanup runs when the selection
 * moves and when the pane unmounts, which are the only two ways a specimen stops being wanted.
 */
function useFontSide(side: ComparisonSide | null, path: string): FontSide {
    const read = useSideBytes(side, path);
    const [family, setFamily] = useState<string | null>(null);
    const [broken, setBroken] = useState(false);

    useEffect(() => {
        setFamily(null);
        setBroken(false);
        const bytes = read.value;
        if (!bytes) {
            return;
        }
        const faces = document.fonts;
        if (typeof FontFace === "undefined" || !faces) {
            setBroken(true);
            return;
        }
        const name = nextFontFamily();
        // A copy of the bytes, so the read's own state is never handed to something that may keep
        // or neuter it.
        const face = new FontFace(name, bytes.slice().buffer as ArrayBuffer);
        let cancelled = false;
        let installed = false;
        void face.load()
            .then(loaded => {
                if (cancelled) return;
                faces.add(loaded);
                installed = true;
                setFamily(name);
            })
            .catch(() => {
                // A file that is not a font, or one the parser rejects. Said out loud rather than
                // left as a specimen quietly set in the system's default face, which reads as a
                // typeface that simply looks like every other one.
                if (!cancelled) setBroken(true);
            });

        return () => {
            cancelled = true;
            if (installed) {
                faces.delete(face);
                installed = false;
            }
        };
    }, [read.value]);

    return { status: read.status, size: read.size, family, broken };
}

/* ---------------------------------------------------------------------------------------- */
/* Words                                                                                      */
/* ---------------------------------------------------------------------------------------- */

/** What a box says when it has no type in it. Three facts, and they stay three. */
function stateKey(side: FontSide): TranslationKey {
    if (side.status === "tooLarge") return "documentDiff.presenter.font.tooLarge";
    if (side.status === "failed" || side.status === "unsupported" || side.broken) {
        return "documentDiff.presenter.font.unreadable";
    }
    return "documentDiff.rows.loading";
}

/** Why nothing is drawn, when nothing is. The side that has something to say wins. */
function failureKey(before: FontSide, after: FontSide): TranslationKey {
    return stateKey(after.status === "absent" ? before : after);
}

/** Which words go under one specimen. Null for a move: it is one file under two names. */
function sideCaption(kind: DocumentChangeKind, which: "before" | "after"): TranslationKey | null {
    if (kind === "added") return "documentDiff.shell.fileAdded";
    if (kind === "removed") return "documentDiff.shell.fileRemoved";
    if (kind === "moved") return null;
    return which === "before" ? "documentDiff.presenter.before" : "documentDiff.presenter.after";
}

/**
 * Whether this side has finished trying.
 *
 * `ready` is not the end of it: the bytes are in hand and the font system has still to accept
 * them, and treating that moment as settled would put "could not be loaded" on screen for every
 * font, briefly, on its way to being drawn.
 */
function isSettled(side: FontSide): boolean {
    switch (side.status) {
        case "loading":
            return false;
        case "ready":
            return side.family !== null || side.broken;
        default:
            return true;
    }
}

export const fontChangePresenter: ChangePresenter = {
    id: "font",
    matches: isFontEntry,
    Detail: FontChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`. A presenter that is
// only exported is a presenter nobody ever sees.
registerChangePresenter(fontChangePresenter);
