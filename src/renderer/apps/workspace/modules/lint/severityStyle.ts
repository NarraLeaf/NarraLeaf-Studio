import { CircleX, Info, TriangleAlert } from "lucide-react";
import type { LintSeverity } from "@/lib/lint";

/**
 * How each severity is drawn, for every surface that draws a finding: the Problems panel, the mark
 * beside a story row, and the list under the blueprint editor's canvas. One table, so the same
 * finding never wears two colours in two places.
 *
 * Info is the accent, as the design system assigns it. A minor warning keeps the warning's glyph
 * and drops its colour: it is the same kind of finding, and the colour is what would make it compete
 * with the warnings that need the author first.
 */
export const LINT_SEVERITY_TEXT_CLASS: Record<LintSeverity, string> = {
    error: "text-danger",
    warning: "text-warning",
    minor: "text-fg-muted",
    info: "text-primary",
};

export const LINT_SEVERITY_ICON: Record<LintSeverity, typeof CircleX> = {
    error: CircleX,
    warning: TriangleAlert,
    minor: TriangleAlert,
    info: Info,
};
