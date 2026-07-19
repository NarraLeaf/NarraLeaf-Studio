import fs from "fs/promises";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { getMimeType } from "@shared/utils/fs";
import {
    PLUGIN_REACT_MODULE_SOURCES,
    PLUGIN_RUNTIME_API_MODULE_SOURCE,
} from "@shared/utils/pluginRuntimeApiModule";
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

const PLUGIN_REACT_DOM_CLIENT_MODULE = `
const api = globalThis.__NLS_PLUGIN_MODULE__;
if (!api?.externals?.reactDomClient) {
  throw new Error("NarraLeaf Studio React DOM client runtime is not available (react-dom/client is a workspace-only host module)");
}
const ReactDOMClient = api.externals.reactDomClient;
export default ReactDOMClient.default ?? ReactDOMClient;
export const createRoot = ReactDOMClient.createRoot;
export const hydrateRoot = ReactDOMClient.hydrateRoot;
export const version = ReactDOMClient.version;
`;

const PLUGIN_API_MODULES: Record<string, string> = {
    "/plugin.js": PLUGIN_API_MODULE,
    "/runtime.js": PLUGIN_RUNTIME_API_MODULE_SOURCE,
    // React shims resolve externals from either plugin host global, so they
    // serve workspace studio entries AND Dev Mode plugin widget renderers.
    ...PLUGIN_REACT_MODULE_SOURCES,
    // Mounting React roots is a workspace-only capability.
    "/react-dom-client.js": PLUGIN_REACT_DOM_CLIENT_MODULE,
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
