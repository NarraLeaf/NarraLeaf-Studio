import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { DocumentChangeKind } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { formatBytes } from "../documentChangeView";
import { GenericChangeDetail } from "./GenericChangeDetail";
import {
  registerChangePresenter,
  type ChangePresenter,
  type ChangePresenterProps
} from "./registry";
import { useSideObjectUrl, type ComparisonSide, type SideBytes } from "./comparisonSide";
import { sidesOfEntry } from "./entrySides";
import {
  bitmapMediaType,
  comparableModes,
  framedImageStyle,
  frameStyle,
  isBitmapEntry,
  TRANSPARENCY_BACKDROP,
  unionBox,
  type CompareMode,
  type PixelSize
} from "./bitmapPreview";

/**
 * Two versions of an image, next to each other.
 *
 * The format this matters most for: a visual novel is sprites and backgrounds, they change more
 * often than anything else in the project, and until now the whole of what a comparison could say
 * about one was that it is 40 KB larger and 1024 pixels wide. Nothing in that answers the question
 * the author actually has, which is what the picture looks like now.
 *
 * **The geometry is stated once, at the top, and by this presenter.** The change list has a
 * dimensions row of its own and it is deliberately not drawn as well: that row exists only when
 * both headers were read AND the format is one of the three `readImageDimensions` parses AND the
 * numbers differ, so it is silent for a GIF, for a new file, and for anything the comparison
 * decided not to open. Here both images have been decoded by the browser, so the size is known for
 * every format and for one-sided entries too. Two lines saying the same thing with different
 * coverage is how a surface teaches an author to distrust it, so there is one.
 *
 * **Nothing is stretched to fit.** Both sides are drawn inside one box the size of the larger of
 * them (see `unionBox`), so a sprite that halved is half the size on screen. Fitting each image to
 * its own frame would make the two look identical, which is the one thing a comparison must not
 * do.
 */

/** How much a key press moves the split, as a share of the frame. */
const SPLIT_STEP = 5;

/**
 * The frame's shape before anything has been decoded.
 *
 * A frame is drawn while a side is still being read - it is where the "reading" line goes - and it
 * has to have some shape to be drawn at all. Four by three so the box does not jump much when the
 * real one arrives.
 */
const PENDING_BOX: PixelSize = { width: 4, height: 3 };

export function BitmapChangeDetail({ entry, change, sides }: ChangePresenterProps) {
  const { t } = useTranslation();
  const requested = useMemo(() => sidesOfEntry(entry, sides), [entry, sides]);
  const before = useBitmapSide(requested.before, entry.path);
  const after = useBitmapSide(requested.after, entry.path);

  const modes = comparableModes(before.pixels, after.pixels);
  const [chosen, setChosen] = useState<CompareMode>("side-by-side");
  const mode = modes.includes(chosen) ? chosen : (modes[0] ?? "side-by-side");

  /**
   * Whether this file exists on both sides at all.
   *
   * It decides how many frames are drawn, and it is deliberately NOT "can both be drawn": a
   * changed file whose new version is too large has two sides, one of which has a reason
   * instead of a picture, and dropping that frame would leave the reason nowhere on screen.
   */
  const pair = requested.before !== null && requested.after !== null;
  const box = unionBox(before.pixels, after.pixels) ?? PENDING_BOX;
  const settled = isSettled(before) && isSettled(after);

  // Nothing can be drawn and nothing is still arriving: say why, and hand the pane back to the
  // list of rows, which can always describe a file even when nothing can show it.
  if (settled && !before.pixels && !after.pixels) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-2xs text-fg-muted">{t(failureKey(before, after))}</p>
        <GenericChangeDetail entry={entry} change={change} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Geometry before={before.pixels} after={after.pixels} />
        {modes.length > 1 && (
          <div
            role="group"
            aria-label={t("documentDiff.presenter.image.modeLabel")}
            className="inline-flex divide-x divide-edge overflow-hidden rounded-md border border-edge"
          >
            {modes.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === mode}
                onClick={() => setChosen(option)}
                className={cn(
                  // `nl-focus-ring` rather than a ring utility: `styles.css`
                  // clears box-shadow on every focused native control, so a
                  // `focus:ring-*` here would be dead code.
                  "nl-focus-ring min-h-7 px-2 py-1 text-2xs transition-colors",
                  option === mode
                    ? "bg-primary/15 text-fg"
                    : "text-fg-muted hover:bg-fill hover:text-fg"
                )}
              >
                {t(MODE_LABEL[option])}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Only when both sides are there to be compared: on a one-sided entry the sizes are
                not the same fact, and the line would read as a change that did not happen. */}
      {before.pixels && after.pixels && !modes.includes("difference") && (
        <p className="text-2xs text-warning">{t("documentDiff.presenter.image.sizeDiffers")}</p>
      )}

      {pair && mode === "side-by-side" && (
        <div className="grid grid-cols-2 gap-2">
          <Frame side={before} box={box} caption={sideCaption(entry.kind, "before")} />
          <Frame side={after} box={box} caption={sideCaption(entry.kind, "after")} />
        </div>
      )}
      {pair && mode === "swipe" && <Swipe before={before} after={after} box={box} />}
      {pair && mode === "difference" && <Difference before={before} after={after} box={box} />}
      {/* One side, and no empty frame beside it pretending there is something to compare. */}
      {!pair && (
        <Frame
          side={requested.before ? before : after}
          box={box}
          caption={sideCaption(entry.kind, requested.before ? "before" : "after")}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Pieces                                                                                     */
/* ---------------------------------------------------------------------------------------- */

/**
 * The pixel size, and the change to it where there is one.
 *
 * Tinted when it changed, because this is the thing that breaks a scene: a sprite that is suddenly
 * half as wide is drawn half as wide in the game, and no amount of "it looks fine here" catches
 * it.
 */
function Geometry({ before, after }: { before: PixelSize | null; after: PixelSize | null }) {
  if (!before || !after) {
    const only = before ?? after;
    return only ? <span className="text-2xs text-fg-muted">{dimensions(only)}</span> : null;
  }
  if (before.width === after.width && before.height === after.height) {
    return <span className="text-2xs text-fg-muted">{dimensions(after)}</span>;
  }
  return (
    <span className="text-2xs font-medium text-warning">
      {dimensions(before)} → {dimensions(after)}
    </span>
  );
}

function Frame({
  side,
  box,
  caption
}: {
  side: BitmapSide;
  box: PixelSize;
  caption: TranslationKey | null;
}) {
  const { t } = useTranslation();
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <div
        className="relative w-full overflow-hidden rounded-md border border-edge"
        style={{ ...frameStyle(box), ...TRANSPARENCY_BACKDROP }}
      >
        {side.pixels && side.url ? (
          <img src={side.url} alt="" style={framedImageStyle(side.pixels, box)} />
        ) : (
          <span className="absolute inset-0 grid place-items-center px-2 text-center text-2xs text-fg-muted">
            {t(stateKey(side))}
          </span>
        )}
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

/**
 * Both versions in one frame, with a line the author drags across it.
 *
 * The mode for a repaint: a re-export that moved an eyebrow two pixels is invisible side by side
 * and unmistakable under a line that wipes one version off the other.
 */
function Swipe({ before, after, box }: { before: BitmapSide; after: BitmapSide; box: PixelSize }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);

  const moveTo = (clientX: number): void => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSplit(clamp(((clientX - rect.left) / rect.width) * 100));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    moveTo(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragging.current) moveTo(event.clientX);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragging.current = false;
  };

  return (
    <figure className="flex flex-col gap-1">
      <div
        ref={frame}
        className="relative w-full select-none overflow-hidden rounded-md border border-edge"
        style={{ ...frameStyle(box), ...TRANSPARENCY_BACKDROP }}
      >
        {before.pixels && before.url && (
          <img src={before.url} alt="" style={framedImageStyle(before.pixels, box)} />
        )}
        {after.pixels && after.url && (
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            <img src={after.url} alt="" style={framedImageStyle(after.pixels, box)} />
          </div>
        )}
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("documentDiff.presenter.image.splitPosition")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            const step = SPLIT_KEY[event.key];
            if (step === undefined) return;
            event.preventDefault();
            setSplit((current) =>
              step === "min" ? 0 : step === "max" ? 100 : clamp(current + step)
            );
          }}
          // Wider than the line it draws: a one pixel target is not something anyone can
          // catch, so the handle is 12px of hit area with the line drawn down its middle.
          className="nl-focus-ring absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize"
          style={{ left: `${split}%` }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary" />
        </div>
      </div>
      <figcaption className="flex items-center justify-between text-2xs text-fg-subtle">
        <span>
          {t("documentDiff.presenter.before")} · {formatBytes(before.size)}
        </span>
        <span>
          {t("documentDiff.presenter.after")} · {formatBytes(after.size)}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * The two stacked, with everything that matches turned black.
 *
 * Only offered for images of one size (see `comparableModes`), and drawn on black because that is
 * what the blend mode is defined against: the result is the per-channel distance between the two,
 * so an unchanged pixel is 0 and the backdrop has to be 0 as well. A themed backdrop would add
 * itself to every pixel of the answer.
 */
function Difference({
  before,
  after,
  box
}: {
  before: BitmapSide;
  after: BitmapSide;
  box: PixelSize;
}) {
  const { t } = useTranslation();
  return (
    <figure className="flex flex-col gap-1">
      {/* `isolate` is load-bearing: a blend mode composites against whatever stacking
                context it finds, and without one of its own that is the panel behind the frame
                rather than the black inside it. `bg-black` is one of the deliberate theme-invariant
                surfaces (design-system.md §0) - here because the blend is defined against zero. */}
      <div
        className="relative isolate w-full overflow-hidden rounded-md border border-edge bg-black"
        style={frameStyle(box)}
      >
        {before.pixels && before.url && (
          <img src={before.url} alt="" style={framedImageStyle(before.pixels, box)} />
        )}
        {after.pixels && after.url && (
          <img
            src={after.url}
            alt=""
            style={{ ...framedImageStyle(after.pixels, box), mixBlendMode: "difference" }}
          />
        )}
      </div>
      <figcaption className="text-2xs text-fg-subtle">
        {t("documentDiff.presenter.before")} · {t("documentDiff.presenter.after")}
      </figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Reading one side                                                                           */
/* ---------------------------------------------------------------------------------------- */

interface BitmapSide extends SideBytes {
  /** What the browser decoded, or null while it has not. */
  readonly pixels: PixelSize | null;
  /** True when the bytes arrived and could not be decoded. */
  readonly broken: boolean;
}

/**
 * One side's bytes, plus what they turn out to be a picture of.
 *
 * The size is taken from the decoded image rather than from a header reader, which is the
 * difference between reporting for three formats and reporting for every format the browser can
 * draw - and it is also the check on the bytes: an `<img>` that refuses them is the only reliable
 * statement that a file which claims to be a PNG is not one.
 */
function useBitmapSide(side: ComparisonSide | null, path: string): BitmapSide {
  const bytes = useSideObjectUrl(side, path, bitmapMediaType);
  const [pixels, setPixels] = useState<PixelSize | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setPixels(null);
    setBroken(false);
    if (!bytes.url) {
      return;
    }
    const probe = new Image();
    let done = false;
    probe.onload = () => {
      if (!done) setPixels({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => {
      if (!done) setBroken(true);
    };
    probe.src = bytes.url;
    return () => {
      done = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [bytes.url]);

  return { ...bytes, pixels, broken };
}

/* ---------------------------------------------------------------------------------------- */
/* Words                                                                                      */
/* ---------------------------------------------------------------------------------------- */

const MODE_LABEL: Record<CompareMode, TranslationKey> = {
  "side-by-side": "documentDiff.presenter.image.sideBySide",
  swipe: "documentDiff.presenter.image.swipe",
  difference: "documentDiff.presenter.image.difference"
};

/** Arrow keys move the split; Home and End take it to either edge. */
const SPLIT_KEY: Record<string, number | "min" | "max" | undefined> = {
  ArrowLeft: -SPLIT_STEP,
  ArrowRight: SPLIT_STEP,
  Home: "min",
  End: "max"
};

/**
 * What a frame says when it has no image in it.
 *
 * Four different facts and they stay four: a file past the ceiling, a format nothing here decodes,
 * bytes that are not the picture they claim to be, and a read that has not finished. Collapsing
 * them into "could not be shown" would leave an author unable to tell a limit from a broken file.
 */
function stateKey(side: BitmapSide): TranslationKey {
  if (side.status === "tooLarge") return "documentDiff.presenter.image.tooLarge";
  if (side.status === "unsupported") return "documentDiff.presenter.image.unsupported";
  if (side.status === "failed" || side.broken) return "documentDiff.presenter.image.unreadable";
  return "documentDiff.rows.loading";
}

/**
 * Why nothing is drawn, when nothing is.
 *
 * The side that has something to say wins: with one side absent by construction, the other one's
 * reason is the whole reason.
 */
function failureKey(before: BitmapSide, after: BitmapSide): TranslationKey {
  const speaking = after.status === "absent" ? before : after;
  return stateKey(speaking);
}

/**
 * Which words go under one frame.
 *
 * Null for a moved file: it is one image under two names and calling it "after" would imply a
 * before that is a different picture.
 */
function sideCaption(kind: DocumentChangeKind, which: "before" | "after"): TranslationKey | null {
  if (kind === "added") return "documentDiff.shell.fileAdded";
  if (kind === "removed") return "documentDiff.shell.fileRemoved";
  if (kind === "moved") return null;
  return which === "before" ? "documentDiff.presenter.before" : "documentDiff.presenter.after";
}

function dimensions(size: PixelSize): string {
  return `${size.width} × ${size.height}`;
}

/**
 * Whether this side has finished trying.
 *
 * `ready` is not the end of it: the bytes are in hand and the browser has still to decide whether
 * they are a picture, and treating that moment as settled would put "could not be read" on screen
 * for every image, briefly, on its way to being drawn.
 */
function isSettled(side: BitmapSide): boolean {
  switch (side.status) {
    case "loading":
      return false;
    case "ready":
      return side.pixels !== null || side.broken;
    default:
      return true;
  }
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export const bitmapChangePresenter: ChangePresenter = {
  id: "bitmap",
  matches: isBitmapEntry,
  Detail: BitmapChangeDetail
};

// Registered on import, and imported for that effect by `ChangeDetailHost`. A presenter that is
// only exported is a presenter nobody ever sees.
registerChangePresenter(bitmapChangePresenter);
