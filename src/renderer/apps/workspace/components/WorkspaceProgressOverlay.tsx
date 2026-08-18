import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * How long a wait may run before the workspace says anything about it.
 *
 * A wait that lands inside this is not one anybody was left wondering about, and putting a sheet
 * over the window for two frames would be its own kind of noise. Past it, the window is going to
 * sit there visibly doing nothing - which is the thing these overlays exist to fix.
 */
export const QUIET_WAIT_MS = 250;

/**
 * `true` once `active` has held for {@link QUIET_WAIT_MS}, `false` the moment it stops.
 *
 * Deliberately keyed on whether the wait is running at all, never on which stage of it: what is
 * being timed is how long the author has been waiting, and a stage that advances is progress, not a
 * reason to start the clock over.
 *
 * Only for waits the main thread is *idle* through - the close, which is main-process work this
 * window is watching. A wait that blocks this thread starves the timer along with everything else,
 * and the card would arrive after the wait it was meant to explain; those delay in CSS instead
 * (see {@link CARD_REVEAL_STYLE}).
 */
export function useSettledWait(active: boolean): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!active) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), QUIET_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  return settled;
}

/**
 * The same quiet delay as {@link useSettledWait}, expressed as an animation the compositor owns.
 *
 * For waits that block the main thread: `both` holds the card at `opacity: 0` through the delay,
 * and Chromium runs an opacity animation off-thread, so the reveal lands on time even while nothing
 * else in this window is running. `will-change` is what guarantees the layer is there to run it on.
 *
 * Under `prefers-reduced-motion` the app's own rule collapses the delay to ~0 and the fill keeps the
 * end state, so the card simply appears immediately - never the worst case, which would be an
 * overlay stuck transparent over a window that looks hung.
 */
export const CARD_REVEAL_STYLE: React.CSSProperties = {
  animationDelay: `${QUIET_WAIT_MS}ms`,
  animationFillMode: "both",
  willChange: "opacity"
};

/**
 * The card both workspace waits put on screen: what is happening, and which part of it is running.
 *
 * A spinner rather than a bar, and deliberately: in this app a bar means a real fraction (the
 * wizard's steps, the asset import queue, the localization and voice panels all fill one from a
 * count), and neither of these waits has a fraction to show - the closing checkpoint is a single
 * call into the version-control backend that answers when it answers, and an opening workspace is
 * bounded by whichever service happens to be slow on this project. "Working, duration unknown" is a
 * spinning `Loader2` everywhere else in the Studio, so it is one here too. It also survives
 * `prefers-reduced-motion`, which `.animate-spin` is carved out of in styles.css: a stopped
 * indicator over a window that is not responding would read as the hang it exists to explain.
 *
 * The spin is a transform, so Chromium runs it on the compositor and it keeps turning even while
 * the main thread is busy - which is exactly when these are on screen, and the reason the message
 * below it can go a while without changing.
 */
export function WorkspaceProgressCard({
  title,
  message,
  style
}: {
  title: string;
  message: string;
  /** Extra styling for the card itself - {@link CARD_REVEAL_STYLE} for waits that block the thread. */
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={style}
      className="relative w-[340px] max-w-full bg-surface-overlay border border-edge rounded-lg shadow-2xl px-5 py-4 animate-fade-in"
    >
      <p className="text-sm font-medium text-fg">{title}</p>
      <div className="mt-2 flex items-start gap-3">
        <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
        <p className="text-sm text-fg-muted">{message}</p>
      </div>
    </div>
  );
}
