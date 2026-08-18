import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "@/lib/i18n";

/**
 * The draggable edge between an index and the detail beside it.
 *
 * One implementation for both two-pane version surfaces - the comparison tab and the merge panel -
 * because they are the same surface with different rows in the left column. Two dividers would be
 * two answers to "how wide is the list", and the author would have to learn each of them.
 */

/** How wide an index starts, and how far it may be dragged. */
export const INDEX_DEFAULT_WIDTH = 280;
export const INDEX_MIN_WIDTH = 200;
export const INDEX_MAX_WIDTH = 520;
/** One arrow key press on the divider. */
const INDEX_KEYBOARD_STEP = 16;

export function clampIndexWidth(value: number): number {
  return Math.min(INDEX_MAX_WIDTH, Math.max(INDEX_MIN_WIDTH, Math.round(value)));
}

export interface IndexDividerProps {
  readonly width: number;
  onWidth(next: number): void;
  /** Where a double click puts it back to. The surface's own starting width. */
  readonly defaultWidth?: number;
}

/**
 * A `div` rather than a button: `styles.css` drops `box-shadow` on every native control, so a focus
 * ring on one is dead code (design-system §5), and this needs a visible focus because the arrow keys
 * are the only way to move it without a pointer.
 */
export function IndexDivider({
  width,
  onWidth,
  defaultWidth = INDEX_DEFAULT_WIDTH
}: IndexDividerProps) {
  const { t } = useTranslation();
  const widthRef = useRef(width);
  widthRef.current = width;

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const sash = event.currentTarget;
      sash.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startWidth = widthRef.current;
      // A drag that leaves the divider would otherwise select text and flip the cursor over
      // whatever it passes; both are pinned for the duration.
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        onWidth(clampIndexWidth(startWidth + (moveEvent.clientX - startX)));
      };
      const onUp = () => {
        sash.removeEventListener("pointermove", onMove);
        sash.removeEventListener("pointerup", onUp);
        sash.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
      };

      sash.addEventListener("pointermove", onMove);
      sash.addEventListener("pointerup", onUp);
      sash.addEventListener("pointercancel", onUp);
    },
    [onWidth]
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("documentDiff.shell.resize")}
      onPointerDown={handlePointerDown}
      onDoubleClick={() => onWidth(defaultWidth)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? INDEX_KEYBOARD_STEP : -INDEX_KEYBOARD_STEP;
        onWidth(clampIndexWidth(widthRef.current + delta));
      }}
      // The same affordance the editor split's sash wears: the line itself recolours on hover
      // and on focus, which is also the focus indicator - a ring here would be a second idea
      // about what a grabbed divider looks like.
      className="w-1 shrink-0 cursor-col-resize bg-transparent outline-none transition-colors duration-150 hover:bg-primary/50 focus:bg-primary/50"
    />
  );
}
