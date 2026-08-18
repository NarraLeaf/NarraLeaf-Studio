import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { resolvePageAnimationMotion } from "@/lib/ui-editor/runtime/pageAnimation";
import type { ElementAnimationTiming } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";

/**
 * Whether the Surface these elements belong to has finished its hidden prepaint pass.
 *
 * Elements mount while the Surface is still invisible, so starting their enter animations on mount
 * would play them behind the curtain: by the time the layer is revealed they would be over. The
 * Surface animation layer publishes the moment it is about to be shown, and every element on it
 * begins from there - the same instant the Surface's own enter animation begins.
 *
 * Defaults to true for hosts that render an element tree with no Surface animation layer above it.
 */
export const SurfaceEnterReadyContext = createContext(true);

export type ElementAnimationScope = {
  /** Absolute ms (plan time) at which the subtree currently arriving began arriving. */
  enterBaseMs: number;
  /** Absolute ms (plan time) at which the subtree currently leaving began leaving. */
  exitBaseMs: number;
};

const ROOT_SCOPE: ElementAnimationScope = { enterBaseMs: 0, exitBaseMs: 0 };

/**
 * Which subtree's clock the elements below are on.
 *
 * The plan measures everything from the Surface, but a change does not always start there: hiding
 * one container starts a change whose origin is that container. Everything under the origin
 * subtracts the origin's own offset, so a container that a Page would have moved half a second in
 * still leaves immediately when it is hidden on its own.
 */
export const ElementAnimationScopeContext = createContext<ElementAnimationScope>(ROOT_SCOPE);

/**
 * The wrapper that lets an element leave.
 *
 * `propagate` is what makes the wait chain a chain: a nested presence exits when the presence above
 * it does, and reports back only once everything inside it has finished. So a Surface that waits for
 * its children, holding a container that waits for *its* children, unmounts in the right order
 * without anyone counting the levels.
 */
export function ElementAnimationPresence(props: {
  timing: ElementAnimationTiming;
  visible: boolean;
  children: ReactNode;
}) {
  const { timing, visible, children } = props;
  const inherited = useContext(ElementAnimationScopeContext);
  const isParentPresent = useIsPresent();
  // After the first commit this element is old enough that anything appearing inside it appeared on
  // its own account - a blueprint showing it - rather than as part of the Surface arriving.
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    setSettled(true);
  }, []);

  const scope = useMemo<ElementAnimationScope>(
    () => ({
      enterBaseMs: settled ? timing.enterOriginMs : inherited.enterBaseMs,
      exitBaseMs: isParentPresent ? timing.exitOriginMs : inherited.exitBaseMs
    }),
    [
      inherited.enterBaseMs,
      inherited.exitBaseMs,
      isParentPresent,
      settled,
      timing.enterOriginMs,
      timing.exitOriginMs
    ]
  );

  return (
    <ElementAnimationScopeContext.Provider value={scope}>
      {/* `presenceAffectsLayout` off: it rebuilds the context on every render (by design, for
                layout animations), which would re-render every element under this one for nothing. */}
      <AnimatePresence propagate initial={false} presenceAffectsLayout={false}>
        {visible ? children : null}
      </AnimatePresence>
    </ElementAnimationScopeContext.Provider>
  );
}

/**
 * Sits between an element's node wrapper and its content, and is the only thing that moves.
 *
 * Not the node wrapper itself: that one's transform channels are owned by Displayable motion (held
 * offsets, one-shot effects), and two owners of one transform means the last writer wins. Being one
 * box further in also keeps the element's layout slot still while its content animates.
 */
export function ElementAnimationLayer(props: {
  timing: ElementAnimationTiming;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const { timing, reducedMotion, children } = props;
  const scope = useContext(ElementAnimationScopeContext);
  const surfaceReady = useContext(SurfaceEnterReadyContext);
  const enterDelayMs = Math.max(0, timing.enterStartMs - scope.enterBaseMs);
  const exitDelayMs = Math.max(0, timing.exitStartMs - scope.exitBaseMs);

  /**
   * The enter delay is captured when the animation starts, and never read again.
   *
   * The scope above resolves one commit after this layer mounts (that is what `settled` is), and
   * an enter delay that changed mid-flight would restart the tween - leaving the element frozen at
   * whatever pose it had reached for the length of the new delay.
   */
  const [startedDelayMs, setStartedDelayMs] = useState<number | null>(null);
  useLayoutEffect(() => {
    setStartedDelayMs((current) => (current === null ? enterDelayMs : current));
    // Deliberately keyed on readiness alone: re-running it on a delay change is exactly what the
    // capture exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceReady]);
  const started = surfaceReady && startedDelayMs !== null;

  const variants = useMemo(() => {
    const targets = resolvePageAnimationMotion({
      settings: timing.settings,
      navigationDirection: "forward",
      reducedMotion,
      delays: { enterMs: startedDelayMs ?? 0, exitMs: exitDelayMs }
    });
    return {
      enter: { ...targets.initial, transition: { duration: 0 } },
      animate: targets.animate,
      // An element on its way out must not still take clicks; the Surface layer does the same.
      exit: { ...targets.exit, pointerEvents: "none" }
    };
  }, [exitDelayMs, reducedMotion, startedDelayMs, timing.settings]);

  return (
    <motion.div
      className="nl-element-animation"
      style={LAYER_STYLE}
      variants={variants}
      initial={false}
      animate={started ? "animate" : "enter"}
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

/**
 * Exactly the content box of the node wrapper above it, which is a column flex container. Anything
 * else here would move every animated widget by a pixel the moment an animation was added.
 */
const LAYER_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0
};
