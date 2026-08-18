// Layout components
export { AppLayout } from "./AppLayout";
export { TitleBar } from "./TitleBar";
export { useWindowOverlayHost, windowRootProps } from "./windowOverlayHost";
export { DetachedWindow, focusDetachedWindow } from "./DetachedWindow";
export {
  HostWindowProvider,
  useDetachedWindowKey,
  useHostDocument,
  useHostWindow,
  useIsDetachedHost
} from "./hostWindow";
export { DetachedTitleBarControls, useDetachedTitleBar } from "./detachedTitleBar";

// Types
export type { AppLayoutProps } from "./AppLayout";
export type { TitleBarProps } from "./TitleBar";
