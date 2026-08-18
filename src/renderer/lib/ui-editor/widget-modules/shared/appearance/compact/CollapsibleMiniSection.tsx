import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";

type Props = {
  title: string;
  defaultCollapsed?: boolean;
  /** When true, header shows muted style (empty state hint). */
  subtle?: boolean;
  children: React.ReactNode;
};

/**
 * Lightweight collapsible block for compact appearance panels (matches property section affordance).
 *
 * The header is an {@link InspectOnlyButton} because expanding a section is looking, and this block
 * lives inside inspector fields that a frozen workspace clamps with a `disabled` `<fieldset>`. As a
 * `<button>` it was caught by that clamp, which left the author of a frozen project unable to open
 * any appearance module at all - the section's contents were not read-only, they were unreachable.
 */
export function CollapsibleMiniSection({
  title,
  defaultCollapsed = true,
  subtle,
  children
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return (
    <div className="rounded-lg border border-edge bg-fill-subtle overflow-hidden min-w-0">
      <InspectOnlyButton
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-fill-subtle transition cursor-default"
      >
        <span className="text-fg-subtle shrink-0">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </span>
        <span
          className={`text-2xs font-medium tracking-wide ${
            subtle ? "text-fg-subtle" : "text-fg-muted"
          }`}
        >
          {title}
        </span>
      </InspectOnlyButton>
      {!collapsed && (
        <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-edge-subtle">{children}</div>
      )}
    </div>
  );
}
