import type { HTMLAttributes, ReactNode } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/lib/components/elements";

/**
 * The notice an agent's hold on part of Studio floats over that part: two lines and one action,
 * centred at the top or bottom of the nearest positioned ancestor. Used by Dev Mode while an agent play-tests in
 * it and by an editor an agent has set read-only.
 *
 * Centred by a flex row, not a translate: in the Dev Mode window the engine's stylesheet overrides
 * Tailwind's transform utilities.
 *
 * Comments in English per project convention.
 */
export function AgentCapsule(props: {
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
    /** Attributes for the capsule itself (a marker another module finds it by). */
    capsuleProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>;
    /** Attributes for the action button. */
    actionProps?: Record<`data-${string}`, string>;
    /** Above everything in the window (Dev Mode) rather than the editor's own layers. */
    zIndex?: number;
    /**
     * `top` over a game window, whose top edge is the letterbox; `bottom` in an editor, whose top
     * edge is its toolbar and must stay clickable.
     */
    placement?: "top" | "bottom";
    /**
     * Where the band the capsule is centred in starts and how far it sits from its edge, for an
     * editor with chrome of its own there (a sidebar over the canvas, a docked bar at the bottom).
     */
    position?: { left?: string; offset?: string };
}): ReactNode {
    const { title, detail, action, onAction, capsuleProps, actionProps, zIndex, placement = "top", position } = props;
    const edge = position?.offset ?? (placement === "top" ? "12px" : "16px");
    return (
        <div
            className="pointer-events-none absolute right-0 z-30 flex justify-center"
            style={{
                left: position?.left ?? "0px",
                ...(placement === "top" ? { top: edge } : { bottom: edge }),
                ...(zIndex === undefined ? {} : { zIndex }),
            }}
        >
            <div
                role="status"
                {...capsuleProps}
                className="pointer-events-auto flex items-center gap-3 rounded-full border border-edge bg-surface-overlay py-1.5 pl-3.5 pr-1.5 shadow-md"
            >
                <Bot className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                <div className="flex flex-col leading-tight">
                    <span className="text-xs text-fg">{title}</span>
                    <span className="text-2xs text-fg-muted">{detail}</span>
                </div>
                <Button size="sm" variant="secondary" className="rounded-full" {...actionProps} onClick={onAction}>
                    {action}
                </Button>
            </div>
        </div>
    );
}
