/**
 * The two colours a reported failure is drawn in, shared by the strip at the top of the window and
 * the Issues panel in the debug drawer — one list of failures painted in two places must not be able
 * to disagree about which of them is an error.
 *
 * Written out per level rather than composed from a variable, because Tailwind reads these as
 * literals — and `border-current/40` is not the shortcut it looks like: `currentColor` cannot carry
 * Tailwind's alpha channel, so the opacity silently does nothing.
 */
export const RUNTIME_ISSUE_TONE = {
  error: {
    strip: "border-danger/40 bg-danger/15 text-danger",
    text: "text-danger",
    button: "border-danger/50 hover:bg-danger/25",
    ghost: "hover:bg-danger/20"
  },
  warning: {
    strip: "border-warning/40 bg-warning/15 text-warning",
    text: "text-warning",
    button: "border-warning/50 hover:bg-warning/25",
    ghost: "hover:bg-warning/20"
  }
} as const;

export type RuntimeIssueTone = (typeof RUNTIME_ISSUE_TONE)[keyof typeof RUNTIME_ISSUE_TONE];
