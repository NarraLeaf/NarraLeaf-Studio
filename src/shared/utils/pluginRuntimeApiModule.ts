/**
 * Source of the `narraleaf-studio/runtime` ESM shim served to plugin runtime
 * entries. Shared by the Studio `app://plugin-api/runtime.js` handler (Dev
 * Mode window) and the standalone game runtime's `nlgame://plugin-api/runtime.js`
 * handler so both environments expose the identical module surface.
 *
 * The shim re-exports from a frozen global installed by the runtime plugin
 * loader (loadRuntimePlugins.exposeRuntimePluginModule); importing the module
 * anywhere else fails with a clear error.
 */
export const PLUGIN_RUNTIME_API_MODULE_SOURCE = `
const api = globalThis.__NLS_RUNTIME_PLUGIN_MODULE__;
if (!api) {
  throw new Error("NarraLeaf game runtime plugin host is not available (narraleaf-studio/runtime can only be imported by plugin runtime entries loaded in a game environment)");
}
export const defineRuntimePlugin = api.defineRuntimePlugin;
export default api;
`;
