import { render } from "@lib/renderApp";
import { installStudioDebugBridge } from "@lib/workspace/debug/studioDebugBridge";

// Dev builds only: expose the Console service to the main-process debug server.
// `__NLS_STUDIO_DEV__` is an esbuild define, so this whole branch is dropped
// from production bundles.
if (__NLS_STUDIO_DEV__) {
    installStudioDebugBridge();
}

render(import("./WorkSpaceApp"));
