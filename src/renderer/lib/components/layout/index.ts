// Layout components
export { AppLayout } from "./AppLayout";
export { TitleBar } from "./TitleBar";
export { useWindowOverlayHost, windowRootProps } from "./windowOverlayHost";
export { DetachedWindow, focusDetachedWindow } from "./DetachedWindow";
export { HostWindowProvider, useDetachedWindowKey, useHostDocument, useHostWindow, useIsDetachedHost } from "./hostWindow";
export { DetachedTitleBarControls, useDetachedTitleBar } from "./detachedTitleBar";
export { HostVisibility, useDismissWhenHidden, useHostVisible } from "./hostVisibility";
export { FLOATING_OWN_KEYS_ATTRIBUTE, useFloatingLayer } from "./floatingLayer";
export type { FloatingFocusScope, FloatingLayerOptions } from "./floatingLayer";

// Types
export type { AppLayoutProps } from "./AppLayout";
export type { TitleBarProps } from "./TitleBar";
