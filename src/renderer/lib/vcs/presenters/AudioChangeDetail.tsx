import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { DocumentChangeKind } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { readMediaHeader } from "@shared/utils/mediaHeader";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { formatBytes } from "../documentChangeView";
import { GenericChangeDetail } from "./GenericChangeDetail";
import {
  registerChangePresenter,
  type ChangePresenter,
  type ChangePresenterProps
} from "./registry";
import { useSideBytes, type ComparisonSide, type SideBytesStatus } from "./comparisonSide";
import { sidesOfEntry } from "./entrySides";
import {
  formatClock,
  formatSampleRate,
  withinDecodeBudget,
  isAudioEntry,
  peaksOf,
  timelineShares,
  type WaveformPeaks
} from "./audioPreview";

/**
 * Two versions of a sound, one above the other, on one timeline.
 *
 * **The timeline is shared and nothing is stretched to fill it.** A waveform fitted to its own box
 * is a picture of a shape, and the shape is rarely what changed: a re-recorded line that runs two
 * seconds longer, a music loop trimmed to fit, a cue with silence left on the front. Drawn against
 * the longer of the two, the shorter one stops short, and the difference is the thing an author
 * sees first. See `timelineShares`.
 *
 * **The numbers are stated once, at the top, and by this presenter.** The change list has duration
 * and sample-rate rows of its own and they are deliberately not drawn as well: those rows come from
 * a bounded prefix of the file, so they are silent for an Ogg (whose length lives at the end), for
 * a one-sided entry, and for anything the comparison decided not to open. Here both sides have been
 * decoded, so every number is known for every format the browser plays. Two lines saying the same
 * thing with different coverage is how a surface teaches an author to distrust it, so there is one.
 *
 * **Nothing plays until it is asked to, and only one side plays at a time.** Two versions of the
 * same cue overlapping is not a comparison of them.
 */

/** Columns a waveform is reduced to. Wider than the pane, so the picture survives being scaled. */
const WAVEFORM_COLUMNS = 640;

/** The waveform bitmap's height. Drawn at `h-16`, so this is two device pixels per CSS pixel. */
const WAVEFORM_ROWS = 128;

type Which = "before" | "after";

export function AudioChangeDetail({ entry, change, sides }: ChangePresenterProps) {
  const { t } = useTranslation();
  const requested = useMemo(() => sidesOfEntry(entry, sides), [entry, sides]);
  const host = useAudioHost();
  const before = useAudioSide(requested.before, entry.path, host);
  const after = useAudioSide(requested.after, entry.path, host);
  const playback = usePlayback(host);

  const shares = timelineShares(before.durationMs, after.durationMs);
  const settled = isSettled(before) && isSettled(after);

  // Nothing can be drawn and nothing is still arriving: say why, and hand the pane back to the
  // list of rows, which can always describe a file even when nothing can show it.
  if (settled && !before.peaks && !after.peaks) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-2xs text-fg-muted">{t(failureKey(before, after))}</p>
        <GenericChangeDetail entry={entry} change={change} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      <Facts before={before} after={after} />
      <div className="flex flex-col gap-2">
        {requested.before !== null && (
          <Track
            which="before"
            side={before}
            share={shares.before}
            caption={sideCaption(entry.kind, "before")}
            playback={playback}
          />
        )}
        {/* One side, and no empty track beside it pretending there is something to hear. */}
        {requested.after !== null && (
          <Track
            which="after"
            side={after}
            share={shares.after}
            caption={sideCaption(entry.kind, "after")}
            playback={playback}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Pieces                                                                                     */
/* ---------------------------------------------------------------------------------------- */

/**
 * What both versions report about themselves, with the changes tinted.
 *
 * Tinted because these are the two ways a sound file breaks a scene without looking any different:
 * a cue that got longer runs over what comes after it, and one that came back at half the sample
 * rate is the same waveform played through a duller filter.
 */
function Facts({ before, after }: { before: AudioSide; after: AudioSide }) {
  const { t } = useTranslation();
  const channels = (side: AudioSide): string | null => {
    if (side.channels === null) return null;
    if (side.channels === 1) return t("documentDiff.presenter.audio.mono");
    if (side.channels === 2) return t("documentDiff.presenter.audio.stereo");
    return t("documentDiff.presenter.audio.channels", { count: side.channels });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Fact
        before={before.durationMs === null ? null : formatClock(before.durationMs)}
        after={after.durationMs === null ? null : formatClock(after.durationMs)}
      />
      <Fact
        before={before.sampleRate === null ? null : formatSampleRate(before.sampleRate)}
        after={after.sampleRate === null ? null : formatSampleRate(after.sampleRate)}
      />
      <Fact before={channels(before)} after={channels(after)} />
    </div>
  );
}

/** One number: as it stands, or as it changed. Nothing at all where neither side reports it. */
function Fact({ before, after }: { before: string | null; after: string | null }) {
  if (before === null || after === null) {
    const only = before ?? after;
    return only ? <span className="text-2xs text-fg-muted">{only}</span> : null;
  }
  if (before === after) {
    return <span className="text-2xs text-fg-muted">{after}</span>;
  }
  return (
    <span className="text-2xs font-medium text-warning">
      {before} → {after}
    </span>
  );
}

function Track({
  which,
  side,
  share,
  caption,
  playback
}: {
  which: Which;
  side: AudioSide;
  share: number;
  caption: TranslationKey | null;
  playback: Playback;
}) {
  const { t } = useTranslation();
  const playing = playback.playing === which;
  const canPlay = side.buffer !== null;

  return (
    <figure className="flex items-center gap-2">
      <button
        type="button"
        disabled={!canPlay}
        aria-label={t(
          playing ? "documentDiff.presenter.audio.pause" : "documentDiff.presenter.audio.play"
        )}
        onClick={() => side.buffer && playback.toggle(which, side.buffer)}
        className={cn(
          // `nl-focus-ring` rather than a ring utility: `styles.css` clears box-shadow on
          // every focused native control, so a `focus:ring-*` here would be dead code.
          "nl-focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge",
          "text-fg-muted transition-colors hover:bg-fill hover:text-fg",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The timeline. The track inside it is as wide as this side is long. */}
        <div className="w-full">
          <div
            className="relative h-16 overflow-hidden rounded-md border border-edge bg-surface-sunken"
            style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 100)}%` }}
          >
            {side.peaks ? (
              <Waveform
                peaks={side.peaks}
                tone={which === "after" ? "text-primary" : "text-fg-muted"}
              />
            ) : (
              <span className="absolute inset-0 grid place-items-center px-2 text-center text-2xs text-fg-muted">
                {t(stateKey(side))}
              </span>
            )}
            <span
              aria-hidden
              ref={(element) => playback.setPlayhead(which, element)}
              className="pointer-events-none absolute inset-y-0 w-px bg-fg"
              style={{ left: 0 }}
            />
          </div>
        </div>
        <figcaption className="truncate text-2xs text-fg-subtle">
          {/* No size for a side that was never read: `formatBytes(0)` says "0 B", which of
                        a file that is too large to hand over is the opposite of the truth. */}
          {[
            caption ? t(caption) : null,
            side.durationMs === null ? null : formatClock(side.durationMs),
            side.size > 0 ? formatBytes(side.size) : null
          ]
            .filter(Boolean)
            .join(" · ")}
        </figcaption>
      </div>
    </figure>
  );
}

/**
 * The picture itself.
 *
 * Drawn on a canvas rather than as an SVG path because it is 640 columns of two rectangles each and
 * the shape never animates. The colour is read off the element's own `currentColor`, which is how
 * a canvas follows the theme without a second table of colours living next to the token file.
 */
function Waveform({ peaks, tone }: { peaks: WaveformPeaks; tone: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) {
      return;
    }
    context.clearRect(0, 0, element.width, element.height);
    context.fillStyle = window.getComputedStyle(element).color || "#ffffff";
    const middle = element.height / 2;
    const columns = Math.min(peaks.min.length, element.width);
    for (let column = 0; column < columns; column += 1) {
      const top = middle - peaks.max[column] * middle;
      const bottom = middle - peaks.min[column] * middle;
      // At least one pixel: a column of near silence has to be a line rather than nothing,
      // or a quiet passage reads as a gap in the file.
      context.fillRect(column, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks]);

  return (
    <canvas
      ref={canvas}
      width={WAVEFORM_COLUMNS}
      height={WAVEFORM_ROWS}
      className={cn("absolute inset-0 h-full w-full", tone)}
    />
  );
}

/* ---------------------------------------------------------------------------------------- */
/* Reading and decoding one side                                                              */
/* ---------------------------------------------------------------------------------------- */

interface AudioSide {
  readonly status: SideBytesStatus;
  readonly size: number;
  /** What the browser decoded, held because playback needs it. Null until it has. */
  readonly buffer: AudioBuffer | null;
  readonly peaks: WaveformPeaks | null;
  readonly durationMs: number | null;
  readonly sampleRate: number | null;
  readonly channels: number | null;
  /** True when the bytes arrived and no decoder here would take them. */
  readonly broken: boolean;
  /** True when decoding these bytes would cost more memory than a preview may spend. */
  readonly oversized: boolean;
}

interface Decoded {
  readonly buffer: AudioBuffer;
  readonly peaks: WaveformPeaks;
}

/**
 * One side's bytes, and what the browser makes of them.
 *
 * The numbers come from the decoded buffer rather than from a header reader, which is the
 * difference between reporting for the four containers `readMediaHeader` walks and reporting for
 * every format the browser plays - and it is also the check on the bytes: a decoder that refuses
 * them is the only reliable statement that a file which claims to be an Ogg is not one.
 */
function useAudioSide(side: ComparisonSide | null, path: string, host: AudioHost): AudioSide {
  const read = useSideBytes(side, path);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [broken, setBroken] = useState(false);
  const [oversized, setOversized] = useState(false);

  useEffect(() => {
    setDecoded(null);
    setBroken(false);
    setOversized(false);
    const bytes = read.value;
    if (!bytes) {
      return;
    }
    const context = host.open();
    if (!context) {
      setBroken(true);
      return;
    }
    // Asked before anything is allocated. Decoding to find out how big the decode is would be
    // the allocation this refuses, and a sixteen minute track is some 340 MB per side.
    if (!withinDecodeBudget(readMediaHeader(bytes))) {
      setOversized(true);
      return;
    }
    let cancelled = false;
    // A copy, because `decodeAudioData` detaches the buffer it is given: handing it the read's
    // own bytes would empty the state this effect depends on, and the next run of it - a theme
    // change, a re-render - would decode nothing and report a broken file.
    const copy = bytes.slice().buffer as ArrayBuffer;
    void context
      .decodeAudioData(copy)
      .then((buffer) => {
        if (cancelled) return;
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
          buffer.getChannelData(index)
        );
        setDecoded({ buffer, peaks: peaksOf(channels, WAVEFORM_COLUMNS) });
      })
      .catch(() => {
        if (!cancelled) setBroken(true);
      });
    return () => {
      cancelled = true;
    };
  }, [read.value, host]);

  return {
    status: read.status,
    size: read.size,
    buffer: decoded?.buffer ?? null,
    peaks: decoded?.peaks ?? null,
    durationMs: decoded ? decoded.buffer.duration * 1000 : null,
    sampleRate: decoded?.buffer.sampleRate ?? null,
    channels: decoded?.buffer.numberOfChannels ?? null,
    broken,
    oversized
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Playing                                                                                    */
/* ---------------------------------------------------------------------------------------- */

interface AudioHost {
  /** The context, opened on first use. Null where the runtime has no Web Audio at all. */
  open(): AudioContext | null;
  /** The context if one is open. Never opens one. */
  current(): AudioContext | null;
}

/**
 * One `AudioContext` for the pane, opened the first time something needs decoding and closed when
 * the pane goes away.
 *
 * Closed rather than left behind: a context holds an output device open, and this is a surface an
 * author moves through file by file.
 */
function useAudioHost(): AudioHost {
  const context = useRef<AudioContext | null>(null);

  useEffect(
    () => () => {
      void context.current?.close().catch(() => undefined);
      context.current = null;
    },
    []
  );

  return useMemo<AudioHost>(
    () => ({
      open: () => {
        if (context.current) {
          return context.current;
        }
        const Constructor = typeof AudioContext === "undefined" ? null : AudioContext;
        if (!Constructor) {
          return null;
        }
        context.current = new Constructor();
        return context.current;
      },
      current: () => context.current
    }),
    []
  );
}

interface Playback {
  readonly playing: Which | null;
  toggle(which: Which, buffer: AudioBuffer): void;
  setPlayhead(which: Which, element: HTMLElement | null): void;
}

/**
 * Which side is playing, and where its playhead is.
 *
 * **The playhead is written straight to the element rather than held in state.** It moves every
 * frame, and a state update per frame would re-render both tracks - including two canvases - for a
 * line that is one pixel wide.
 *
 * **A context can start suspended.** A window that has not been clicked in gives one back in the
 * `suspended` state, where `start()` is accepted and silent, so every play resumes first. That is
 * also the thing to check when a track looks like it is playing and nothing is audible.
 */
function usePlayback(host: AudioHost): Playback {
  const [playing, setPlaying] = useState<Which | null>(null);
  const heads = useRef<Record<Which, HTMLElement | null>>({ before: null, after: null });
  const lengths = useRef<Record<Which, number>>({ before: 0, after: 0 });
  /** Where each side resumes from, in seconds. */
  const resumeAt = useRef<Record<Which, number>>({ before: 0, after: 0 });
  const source = useRef<AudioBufferSourceNode | null>(null);
  const sounding = useRef<Which | null>(null);
  const startedAt = useRef(0);
  const frame = useRef(0);

  const paint = useCallback((which: Which, seconds: number) => {
    const head = heads.current[which];
    const length = lengths.current[which];
    if (!head) {
      return;
    }
    const share = length > 0 ? Math.min(1, Math.max(0, seconds / length)) : 0;
    head.style.left = `${share * 100}%`;
  }, []);

  /** Stop whatever is sounding, leaving its playhead where it got to. */
  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const node = source.current;
    const which = sounding.current;
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Already finished. Stopping a node twice throws, and there is nothing to undo.
      }
      node.disconnect();
    }
    source.current = null;
    if (which) {
      const context = host.current();
      const elapsed = context ? context.currentTime - startedAt.current : 0;
      resumeAt.current[which] = Math.min(lengths.current[which], resumeAt.current[which] + elapsed);
      paint(which, resumeAt.current[which]);
    }
    sounding.current = null;
    setPlaying(null);
  }, [host, paint]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      source.current?.disconnect();
      source.current = null;
    },
    []
  );

  const toggle = useCallback(
    (which: Which, buffer: AudioBuffer) => {
      if (sounding.current === which) {
        halt();
        return;
      }
      halt();
      const context = host.open();
      if (!context) {
        return;
      }
      // Silent otherwise, and silent in a way that looks like a broken file rather than a
      // browser policy: the node starts, the playhead moves and nothing comes out.
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.onended = () => {
        cancelAnimationFrame(frame.current);
        resumeAt.current[which] = 0;
        paint(which, 0);
        source.current = null;
        sounding.current = null;
        setPlaying(null);
      };
      lengths.current[which] = buffer.duration;
      if (resumeAt.current[which] >= buffer.duration) {
        resumeAt.current[which] = 0;
      }
      startedAt.current = context.currentTime;
      node.start(0, resumeAt.current[which]);
      source.current = node;
      sounding.current = which;
      setPlaying(which);

      const step = (): void => {
        const running = sounding.current;
        const now = host.current();
        if (!running || !now) {
          return;
        }
        paint(running, resumeAt.current[running] + (now.currentTime - startedAt.current));
        frame.current = requestAnimationFrame(step);
      };
      step();
    },
    [halt, host, paint]
  );

  const setPlayhead = useCallback((which: Which, element: HTMLElement | null) => {
    heads.current[which] = element;
  }, []);

  return { playing, toggle, setPlayhead };
}

/* ---------------------------------------------------------------------------------------- */
/* Words                                                                                      */
/* ---------------------------------------------------------------------------------------- */

/**
 * What a track says when it has no waveform in it.
 *
 * Three facts and they stay three: a file past the ceiling, bytes no decoder here would take, and
 * a read that has not finished.
 */
function stateKey(side: AudioSide): TranslationKey {
  if (side.status === "tooLarge") return "documentDiff.presenter.audio.tooLarge";
  if (side.status === "failed" || side.status === "unsupported" || side.broken) {
    return "documentDiff.presenter.audio.unreadable";
  }
  return "documentDiff.rows.loading";
}

/** Why nothing is drawn, when nothing is. The side that has something to say wins. */
function failureKey(before: AudioSide, after: AudioSide): TranslationKey {
  // Said ahead of every other reason: a file this long is a working file, not a broken one, and
  // "could not be read" about a track the author can play in any editor is the wrong sentence.
  if (before.oversized || after.oversized) {
    return "documentDiff.presenter.audio.tooLong";
  }
  return stateKey(after.status === "absent" ? before : after);
}

/**
 * Which words go under one track.
 *
 * Null for a moved file: it is one sound under two names and calling it "after" would imply a
 * before that is a different recording.
 */
function sideCaption(kind: DocumentChangeKind, which: Which): TranslationKey | null {
  if (kind === "added") return "documentDiff.shell.fileAdded";
  if (kind === "removed") return "documentDiff.shell.fileRemoved";
  if (kind === "moved") return null;
  return which === "before" ? "documentDiff.presenter.before" : "documentDiff.presenter.after";
}

/**
 * Whether this side has finished trying.
 *
 * `ready` is not the end of it: the bytes are in hand and the decoder has still to have its say,
 * and treating that moment as settled would put "could not be read" on screen for every sound
 * file, briefly, on its way to being drawn.
 */
function isSettled(side: AudioSide): boolean {
  switch (side.status) {
    case "loading":
      return false;
    case "ready":
      return side.peaks !== null || side.broken || side.oversized;
    default:
      return true;
  }
}

export const audioChangePresenter: ChangePresenter = {
  id: "audio",
  matches: isAudioEntry,
  Detail: AudioChangeDetail
};

// Registered on import, and imported for that effect by `ChangeDetailHost`. A presenter that is
// only exported is a presenter nobody ever sees.
registerChangePresenter(audioChangePresenter);
