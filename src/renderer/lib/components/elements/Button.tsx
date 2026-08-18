import React from "react";
import { cn } from "../../utils/cn";
import { CONTROL_SIZE_CLASS, CONTROL_SQUARE_CLASS, type ControlSize } from "./controlSize";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = ControlSize;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  fullWidth?: boolean;
  /**
   * Declared rather than inherited: `ButtonHTMLAttributes` carries no `ref`, so without this a
   * caller that needs to measure the button - anchoring a popover to it, say - is turned away by
   * the type even though React 19 passes the ref straight through to the element below.
   */
  ref?: React.Ref<HTMLButtonElement>;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:brightness-110",
  secondary: "bg-fill text-fg-muted hover:bg-fill-strong hover:text-fg",
  ghost: "text-fg-muted hover:bg-fill hover:text-fg",
  danger: "bg-danger text-white hover:brightness-110"
};

const sizeStyles = CONTROL_SIZE_CLASS;

/**
 * Universal button component with consistent styling
 * Follows VS Code-like design with subtle animations
 */
export function Button({
  variant = "secondary",
  size = "md",
  children,
  className = "",
  fullWidth = false,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "transition-all duration-150 ease-out focus:outline-none",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-default",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Icon-only button variant
 */
export function IconButton({
  variant = "ghost",
  size = "md",
  className = "",
  "aria-label": ariaLabel,
  ...props
}: Omit<ButtonProps, "children"> & {
  "aria-label": string;
  /**
   * The icon to render. Optional (unlike Button, which requires children),
   * but not omitted: the icon reaches the <button> through the {...props}
   * spread below, so the type has to admit it.
   */
  children?: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "grid place-items-center rounded-md",
        "transition-all duration-150 ease-out focus:outline-none",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-default",
        variantStyles[variant],
        // Square, on the same scale as `Button` - an icon button in a row of
        // controls is exactly as tall as they are.
        CONTROL_SQUARE_CLASS[size],
        className
      )}
      aria-label={ariaLabel}
      {...props}
    />
  );
}
