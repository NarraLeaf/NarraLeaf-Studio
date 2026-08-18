import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type LivePreviewFrameProps = {
  /** Identity of the thing being previewed; a change here throws the cached tree away. */
  previewId: string;
  /** Counter that moves only when this preview's own content changed. */
  contentRevision: number;
  /** Built lazily: not called until the card has been on screen, and not again until the revision moves. */
  render: () => ReactNode;
  designWidth: number;
  designHeight: number;
  frameHeight: number;
  className: string;
};

/**
 * A thumbnail that renders a real element tree, and pays for it once.
 *
 * Two things make a panel full of these affordable. The tree is only built after the card has been
 * scrolled into view, so opening a project with thirty pages costs what is on screen rather than
 * what exists; and it is rebuilt only when `contentRevision` moves, so editing one page leaves the
 * other twenty-nine cards untouched instead of re-running every widget renderer in the project on
 * each keystroke. Once built, a card stays built - scrolling back to it must not flash.
 */
export const LivePreviewFrame = memo(
  function LivePreviewFrame({
    previewId,
    contentRevision,
    render,
    designWidth,
    designHeight,
    frameHeight,
    className
  }: LivePreviewFrameProps) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [frameWidth, setFrameWidth] = useState(0);
    const [hasBeenVisible, setHasBeenVisible] = useState(false);

    useEffect(() => {
      const node = frameRef.current;
      if (!node) {
        return undefined;
      }

      setFrameWidth(Math.max(0, node.clientWidth));
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        setFrameWidth(Math.max(0, entry?.contentRect.width ?? node.clientWidth));
      });
      resizeObserver.observe(node);

      if (typeof IntersectionObserver !== "function") {
        setHasBeenVisible(true);
        return () => resizeObserver.disconnect();
      }
      // A generous margin so a card is already drawn by the time it reaches the edge of the
      // list, rather than appearing under the scroll.
      const intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setHasBeenVisible(true);
            intersectionObserver.disconnect();
          }
        },
        { rootMargin: "200px" }
      );
      intersectionObserver.observe(node);

      return () => {
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
      };
    }, []);

    const safeWidth = Math.max(1, designWidth);
    const safeHeight = Math.max(1, designHeight);
    const scale = frameWidth > 0 ? Math.min(frameWidth / safeWidth, frameHeight / safeHeight) : 0;
    const contentStyle: CSSProperties = {
      left: Math.max(0, (frameWidth - safeWidth * scale) / 2),
      top: Math.max(0, (frameHeight - safeHeight * scale) / 2),
      width: safeWidth,
      height: safeHeight,
      transform: `scale(${scale})`,
      transformOrigin: "top left"
    };

    return (
      <div ref={frameRef} className={className} aria-hidden="true">
        <div className="relative h-full w-full">
          {scale > 0 && hasBeenVisible ? (
            <div className="pointer-events-none absolute" style={contentStyle}>
              <PreviewContent
                previewId={previewId}
                contentRevision={contentRevision}
                render={render}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.previewId === next.previewId &&
    previous.contentRevision === next.contentRevision &&
    previous.designWidth === next.designWidth &&
    previous.designHeight === next.designHeight &&
    previous.frameHeight === next.frameHeight &&
    previous.className === next.className
);

/**
 * Holds the built tree.
 *
 * Separate from the frame because the frame re-renders on resize, and re-running `render()` there
 * would put every widget renderer in the project back on the critical path of dragging the panel
 * divider. `render` is deliberately excluded from the comparison: it closes over the document, and
 * the document is what `contentRevision` already tracks.
 */
const PreviewContent = memo(
  function PreviewContent({
    render
  }: {
    previewId: string;
    contentRevision: number;
    render: () => ReactNode;
  }) {
    return <>{render()}</>;
  },
  (previous, next) =>
    previous.previewId === next.previewId && previous.contentRevision === next.contentRevision
);
