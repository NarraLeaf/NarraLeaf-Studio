import { render } from "@lib/renderApp";
import { installServerTrustDevHook } from "@lib/app/serverTrustPrompt";

// Dev builds only: leave the server trust window raisable from the console, since the
// renderer bridge is revoked once this window has painted. `__NLS_STUDIO_DEV__` is an
// esbuild define, so this whole branch is dropped from production bundles.
if (__NLS_STUDIO_DEV__) {
    installServerTrustDevHook();
}

render(import("./SettingsApp"));
