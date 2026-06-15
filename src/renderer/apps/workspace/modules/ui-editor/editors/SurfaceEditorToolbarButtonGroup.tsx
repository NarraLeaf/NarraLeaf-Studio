import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type SurfaceEditorToolbarButtonGroupProps = {
    children: React.ReactNode;
    /** Accessible name for the segmented control. */
    "aria-label"?: string;
    className?: string;
};

const GROUP_SHELL =
    "inline-flex h-9 shrink-0 overflow-hidden rounded-md border border-white/10 divide-x divide-white/10 bg-[#05060a]/90";

/**
 * Segmented toolbar control: children are separated by vertical dividers; no inner border radius.
 */
export function SurfaceEditorToolbarButtonGroup({
    children,
    "aria-label": ariaLabel,
    className = "",
}: SurfaceEditorToolbarButtonGroupProps) {
    return (
        <div role="group" aria-label={ariaLabel} className={`${GROUP_SHELL} ${className}`.trim()}>
            {children}
        </div>
    );
}

/** Match standalone toolbar buttons: fixed 36×36 cells, no flex grow. */
const SEG_BASE =
    "flex h-9 w-9 shrink-0 items-center justify-center border-0 bg-transparent px-0 text-xs transition-colors outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50";

export type SurfaceEditorToolbarSegButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    children: ReactNode;
};

export const SurfaceEditorToolbarSegButton = forwardRef<HTMLButtonElement, SurfaceEditorToolbarSegButtonProps>(
    function SurfaceEditorToolbarSegButton(
        { active, className = "", children, type = "button", disabled, ...rest },
        ref,
    ) {
        const state = active
            ? "bg-primary/20 text-white"
            : "text-gray-400 hover:bg-white/10 hover:text-white";
        return (
            <button
                ref={ref}
                type={type}
                disabled={disabled}
                className={`${SEG_BASE} ${state} ${className}`.trim()}
                {...rest}
            >
                {children}
            </button>
        );
    },
);

/**
 * Cell wrapper for a custom trigger (e.g. popover) so it stretches like adjacent segment buttons.
 */
export function SurfaceEditorToolbarSegSlot({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={`flex h-9 w-9 shrink-0 items-stretch justify-stretch [&_button]:h-9 [&_button]:w-full [&_button]:min-h-0 [&_button]:rounded-none [&_button]:border-0 ${className}`.trim()}
        >
            {children}
        </div>
    );
}
