/**
 * Sources of the ESM shims served to plugin entries.
 *
 * - `PLUGIN_RUNTIME_API_MODULE_SOURCE`: the `narraleaf-studio/runtime` module.
 *   Served by the Studio `app://plugin-api/runtime.js` handler (Dev Mode
 *   window) and the standalone game runtime's `nlgame://plugin-api/runtime.js`
 *   handler, re-exporting from the frozen global installed by the runtime
 *   plugin loader (loadRuntimePlugins.exposeRuntimePluginModule).
 *
 * - `PLUGIN_REACT_MODULE_SOURCES`: React host externals. Each shim resolves
 *   externals from whichever plugin host global the current environment
 *   exposes - `__NLS_PLUGIN_MODULE__` (workspace studio entries) or
 *   `__NLS_RUNTIME_PLUGIN_MODULE__` (game environments, for plugin widget
 *   renderers) - so one set of sources serves every window. `react-dom/client`
 *   is deliberately NOT available to runtime entries: plugins must not mount
 *   their own React roots inside the game.
 */

export const PLUGIN_RUNTIME_API_MODULE_SOURCE = `
const api = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;
if (!api) {
  throw new Error("NarraLeaf game runtime plugin host is not available (narraleaf-studio/runtime can only be imported by plugin runtime entries loaded in a game environment)");
}
export const defineRuntimePlugin = api.defineRuntimePlugin;
export default api;
`;

const RESOLVE_EXTERNALS = `
const externals = globalThis.__NLS_PLUGIN_MODULE__?.externals ?? globalThis.__NLS_RUNTIME_PLUGIN_MODULE__?.externals;
if (!externals) {
  throw new Error("NarraLeaf plugin React host runtime is not available (React host modules can only be imported by plugin entries loaded by a NarraLeaf host)");
}
`;

const PLUGIN_REACT_MODULE = `${RESOLVE_EXTERNALS}
const React = externals.react;
const ReactDefault = React.default ?? React;
export default ReactDefault;
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const act = React.act;
export const cache = React.cache;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const use = React.use;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useOptimistic = React.useOptimistic;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
`;

const PLUGIN_REACT_DOM_MODULE = `${RESOLVE_EXTERNALS}
const ReactDOM = externals.reactDom;
export default ReactDOM.default ?? ReactDOM;
export const createPortal = ReactDOM.createPortal;
export const flushSync = ReactDOM.flushSync;
export const preconnect = ReactDOM.preconnect;
export const prefetchDNS = ReactDOM.prefetchDNS;
export const preinit = ReactDOM.preinit;
export const preinitModule = ReactDOM.preinitModule;
export const preload = ReactDOM.preload;
export const preloadModule = ReactDOM.preloadModule;
export const requestFormReset = ReactDOM.requestFormReset;
export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;
export const useFormState = ReactDOM.useFormState;
export const useFormStatus = ReactDOM.useFormStatus;
export const version = ReactDOM.version;
`;

const PLUGIN_REACT_JSX_RUNTIME_MODULE = `${RESOLVE_EXTERNALS}
const runtime = externals.jsxRuntime;
export default runtime.default ?? runtime;
export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const jsxDEV = runtime.jsxDEV ?? runtime.jsx;
`;

const PLUGIN_REACT_JSX_DEV_RUNTIME_MODULE = `${RESOLVE_EXTERNALS}
const runtime = externals.jsxDevRuntime;
export default runtime.default ?? runtime;
export const Fragment = runtime.Fragment;
export const jsxDEV = runtime.jsxDEV;
`;

/** Shim sources keyed by the plugin-api path they are served under. */
export const PLUGIN_REACT_MODULE_SOURCES: Record<string, string> = {
    "/react.js": PLUGIN_REACT_MODULE,
    "/react-dom.js": PLUGIN_REACT_DOM_MODULE,
    "/react-jsx-runtime.js": PLUGIN_REACT_JSX_RUNTIME_MODULE,
    "/react-jsx-dev-runtime.js": PLUGIN_REACT_JSX_DEV_RUNTIME_MODULE,
};
