/**
 * Which `nl.video` widgets are previewing on the editor canvas.
 *
 * This is editor state, not document data: it is never written to the UIDocument, never enters the
 * undo stack, and never persists. A Surface with a dozen video widgets would otherwise open as a
 * wall of moving pictures (user ruling 2026-07-29), so the canvas paints the first frame or the
 * poster and stays paused until the author asks for playback from the docker bar.
 *
 * It is a module-level store rather than a field on `UIEditorStateService` because the widget
 * renderer is shared with the packaged game, which gets a stub state service. The runtime never
 * reads this - `renderer.tsx` branches on `hostAdapter.blueprintRuntime` and honors the authored
 * `autoplay` there instead - so keeping it out of the service means no shim has to grow a
 * no-op for it.
 */

type Listener = () => void;

const playingElementIds = new Set<string>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function isVideoPreviewPlaying(elementId: string): boolean {
  return playingElementIds.has(elementId);
}

export function setVideoPreviewPlaying(elementId: string, playing: boolean): void {
  const had = playingElementIds.has(elementId);
  if (had === playing) {
    return;
  }
  if (playing) {
    playingElementIds.add(elementId);
  } else {
    playingElementIds.delete(elementId);
  }
  emit();
}

export function toggleVideoPreviewPlaying(elementId: string): boolean {
  const next = !playingElementIds.has(elementId);
  setVideoPreviewPlaying(elementId, next);
  return next;
}

/**
 * Bumped so a renderer can rewind without owning the DOM node from the docker bar. Restarting is a
 * one-shot request, not a state, so it needs a counter: two "back to start" clicks while the video
 * sits at 0 must both be observable, and a boolean flag would swallow the second.
 */
const restartGenerationByElementId = new Map<string, number>();

export function getVideoPreviewRestartGeneration(elementId: string): number {
  return restartGenerationByElementId.get(elementId) ?? 0;
}

export function requestVideoPreviewRestart(elementId: string): void {
  restartGenerationByElementId.set(elementId, getVideoPreviewRestartGeneration(elementId) + 1);
  emit();
}

export function subscribeVideoPreviewPlayback(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Forget one widget, called when its renderer unmounts.
 *
 * This is what actually keeps the "opens paused" ruling true, and it has to hang off the renderer's
 * lifetime because nothing else here has one: switching Surfaces, closing the editor tab and
 * deleting the element all unmount the renderer and none of them notify this module. Without it the
 * set is also unbounded - an id enters on the first Play and never leaves for the rest of the
 * session - so returning to a Surface replayed every clip the author had ever started on it, which
 * is the wall of moving pictures the ruling exists to prevent.
 *
 * Safe under `React.StrictMode` (on in dev, `renderApp.tsx:105`): its mount / cleanup / mount
 * sequence is synchronous, so the only thing the intervening cleanup can discard is state nobody
 * has had the chance to set.
 */
export function releaseVideoPreviewPlayback(elementId: string): void {
  const had = playingElementIds.delete(elementId);
  const hadGeneration = restartGenerationByElementId.delete(elementId);
  if (had || hadGeneration) {
    emit();
  }
}

/** Test seam only. Production clears per element through {@link releaseVideoPreviewPlayback}. */
export function resetVideoPreviewPlayback(): void {
  const had = playingElementIds.size > 0 || restartGenerationByElementId.size > 0;
  playingElementIds.clear();
  restartGenerationByElementId.clear();
  if (had) {
    emit();
  }
}
