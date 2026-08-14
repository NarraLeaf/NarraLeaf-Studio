import { render } from "@lib/renderApp";
import { installServerTrustDevHook } from "@lib/app/serverTrustPrompt";
import { installStudioDebugBridge } from "@lib/workspace/debug/studioDebugBridge";

// Dev builds only: expose the Console service to the main-process debug server, and
// leave the server trust window raisable from the console after the renderer bridge is
// revoked. `__NLS_STUDIO_DEV__` is an esbuild define, so this whole branch is dropped
// from production bundles.
if (__NLS_STUDIO_DEV__) {
    installStudioDebugBridge();
    installServerTrustDevHook();
}

render(import("./WorkSpaceApp"));
