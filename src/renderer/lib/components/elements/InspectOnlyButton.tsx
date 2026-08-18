import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";

export interface InspectOnlyButtonProps {
  onClick: () => void;
  /** A second, non-primary way in - a blueprint entry opens its own window on a right click. */
  onContextMenu?: (event: MouseEvent<HTMLSpanElement>) => void;
  children: ReactNode;
  /** The control's own reason to be off. A frozen workspace is never one of them. */
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  ref?: Ref<HTMLSpanElement>;
}

/**
 * A control that only looks: it expands a section, opens a popover onto values, or leads into
 * another editor. Nothing it does writes project data.
 *
 * **Rendered as a `<span role="button">` rather than a `<button>`, and that is its entire reason for
 * existing.** The properties framework makes a frozen workspace read-only by wrapping a field in a
 * `disabled` `<fieldset>` (`FieldRenderer`), which is deliberately the browser's own clamp: it
 * reaches every form control beneath it whether or not that control has ever heard of the freeze, so
 * a bespoke `<input>` somewhere in a caller's JSX is disabled without knowing the code exists. The
 * cost of that reach is that HTML gives a disabled fieldset **no way to exempt a descendant** - the
 * one escape in the spec is the fieldset's first `<legend>` child - so the only way for a control to
 * survive inside one is to not be a form control at all.
 *
 * Measured on a frozen workspace with a single element selected, before this existed: no appearance
 * module could be expanded, the per-property animation popover would not open, and the element's
 * blueprint could not be reached from its Interaction tab. All three are reading, and a freeze whose
 * whole purpose is to make a past version readable had switched them off.
 *
 * Keyboard activation is spelled out because a `<span>` has none of its own, and this has to answer
 * to the two keys a real button does. `disabled` is likewise ours to honour: it is the control's own
 * state (an entry with nothing to open), never the freeze - if the freeze is the reason, the control
 * does not belong here.
 */
export function InspectOnlyButton({
  onClick,
  children,
  disabled = false,
  className,
  style,
  onContextMenu,
  ref,
  ...aria
}: InspectOnlyButtonProps) {
  const activate = () => {
    if (disabled) {
      return;
    }
    onClick();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    // Space scrolls the panel otherwise, and the panel this lives in is the one being read.
    // Only `preventDefault`: a real button's activation bubbles, and every call site here was a
    // real button until this pass.
    event.preventDefault();
    activate();
  };

  return (
    <span
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      className={className}
      style={style}
      onClick={activate}
      onContextMenu={disabled ? undefined : onContextMenu}
      onKeyDown={handleKeyDown}
      {...aria}
    >
      {children}
    </span>
  );
}
