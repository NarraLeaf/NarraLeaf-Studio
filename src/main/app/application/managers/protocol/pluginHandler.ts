import fs from "fs/promises";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { getMimeType } from "@shared/utils/fs";
import { PLUGIN_RUNTIME_API_MODULE_SOURCE } from "@shared/utils/pluginRuntimeApiModule";
import type { PluginManager } from "../pluginManager";
import type { ProtocolHandler, ProtocolResponse, ProtocolScheme } from "./types";

const PLUGIN_API_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api) {
  throw new Error("NarraLeaf Studio plugin runtime is not available");
}
export const definePlugin = api.definePlugin;
export const ui = api.ui;
export const AssetType = api.AssetType;
export const AssetSource = api.AssetSource;
export const PanelPosition = api.PanelPosition;
export default api;
`;

const PLUGIN_REACT_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api?.externals?.react) {
  throw new Error("NarraLeaf Studio React runtime is not available");
}
const React = api.externals.react;
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

const PLUGIN_REACT_DOM_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api?.externals?.reactDom) {
  throw new Error("NarraLeaf Studio React DOM runtime is not available");
}
const ReactDOM = api.externals.reactDom;
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

const PLUGIN_REACT_DOM_CLIENT_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api?.externals?.reactDomClient) {
  throw new Error("NarraLeaf Studio React DOM client runtime is not available");
}
const ReactDOMClient = api.externals.reactDomClient;
export default ReactDOMClient.default ?? ReactDOMClient;
export const createRoot = ReactDOMClient.createRoot;
export const hydrateRoot = ReactDOMClient.hydrateRoot;
export const version = ReactDOMClient.version;
`;

const PLUGIN_REACT_JSX_RUNTIME_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api?.externals?.jsxRuntime) {
  throw new Error("NarraLeaf Studio JSX runtime is not available");
}
const runtime = api.externals.jsxRuntime;
export default runtime.default ?? runtime;
export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const jsxDEV = runtime.jsxDEV ?? runtime.jsx;
`;

const PLUGIN_REACT_JSX_DEV_RUNTIME_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api?.externals?.jsxDevRuntime) {
  throw new Error("NarraLeaf Studio JSX dev runtime is not available");
}
const runtime = api.externals.jsxDevRuntime;
export default runtime.default ?? runtime;
export const Fragment = runtime.Fragment;
export const jsxDEV = runtime.jsxDEV;
`;

const PLUGIN_API_MODULES: Record<string, string> = {
    "/plugin.js": PLUGIN_API_MODULE,
    "/runtime.js": PLUGIN_RUNTIME_API_MODULE_SOURCE,
    "/react.js": PLUGIN_REACT_MODULE,
    "/react-dom.js": PLUGIN_REACT_DOM_MODULE,
    "/react-dom-client.js": PLUGIN_REACT_DOM_CLIENT_MODULE,
    "/react-jsx-runtime.js": PLUGIN_REACT_JSX_RUNTIME_MODULE,
    "/react-jsx-dev-runtime.js": PLUGIN_REACT_JSX_DEV_RUNTIME_MODULE,
};

export class PluginEntryHandler implements ProtocolHandler {
    constructor(
        public readonly scheme: string,
        public readonly privileges: ProtocolScheme["privileges"],
        private readonly pluginManager: PluginManager,
    ) {}

    canHandle(url: URL): boolean {
        return url.protocol === `${this.scheme}:` && url.hostname === AppHost.Plugins;
    }

    async handle(request: Request): Promise<ProtocolResponse> {
        const filePath = await this.pluginManager.resolvePluginEntryFile(new URL(request.url));
        if (!filePath) {
            return {
                statusCode: 404,
                headers: { "Content-Type": "text/plain" },
                data: "Plugin entry not found",
            };
        }

        const data = await fs.readFile(filePath);
        return {
            statusCode: 200,
            headers: {
                "Content-Type": getMimeType(filePath) || "text/javascript",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
            data,
        };
    }
}

export class PluginApiHandler implements ProtocolHandler {
    public readonly scheme = AppProtocol;
    public readonly privileges: ProtocolScheme["privileges"] = {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
    };

    canHandle(url: URL): boolean {
        return url.protocol === `${this.scheme}:` && url.hostname === AppHost.PluginApi && Boolean(PLUGIN_API_MODULES[url.pathname]);
    }

    async handle(request: Request): Promise<ProtocolResponse> {
        const url = new URL(request.url);
        const data = PLUGIN_API_MODULES[url.pathname];
        if (!data) {
            return {
                statusCode: 404,
                headers: { "Content-Type": "text/plain" },
                data: "Plugin API module not found",
            };
        }
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "text/javascript",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
            data,
        };
    }
}
