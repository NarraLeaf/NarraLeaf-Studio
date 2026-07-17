import fs from "fs/promises";
import path from "path";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveGameRuntimeInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";
import {
    PLUGIN_REACT_MODULE_SOURCES,
    PLUGIN_RUNTIME_API_MODULE_SOURCE,
} from "@shared/utils/pluginRuntimeApiModule";

/**
 * Static web shell of an exported game. Where the desktop shell serves the
 * runtime through its own privileged protocol (custom scheme, in-memory
 * plugin-api modules, CSP injected at serve time), the web export has no
 * process of its own — everything the browser needs must exist as a plain
 * file with a relative URL. This module emits those files next to the shared
 * renderer bundle: the entry document and the plugin-api ESM shims.
 */

export const WEB_FAVICON_FILENAME = "favicon.png";

/**
 * Which host the emitted entry document targets. The mobile shells serve the
 * very same site — only the entry document differs, and only in its viewport —
 * so the mobile variant is generated from the same pack and injected into the
 * repack, leaving the compiled site on disk exactly what the web target ships.
 */
export type GameWebShellVariant = "web" | "mobile";

export async function writeWebShellFiles(input: {
    appDir: string;
    pack: GameRuntimePackV1;
    hasFavicon: boolean;
}): Promise<void> {
    const pluginApiDir = path.join(input.appDir, "plugin-api");
    await fs.mkdir(pluginApiDir, { recursive: true });
    await fs.writeFile(path.join(pluginApiDir, "runtime.js"), PLUGIN_RUNTIME_API_MODULE_SOURCE, "utf-8");
    for (const [servedPath, source] of Object.entries(PLUGIN_REACT_MODULE_SOURCES)) {
        await fs.writeFile(path.join(pluginApiDir, servedPath.replace(/^\//, "")), source, "utf-8");
    }
    await fs.writeFile(
        path.join(input.appDir, "index.html"),
        buildWebIndexHtml(input.pack, { hasFavicon: input.hasFavicon }),
        "utf-8",
    );
}

/**
 * The exported entry document. All URLs are relative so the site works from
 * any host and any sub-path. web.js loads synchronously ahead of the deferred
 * renderer bundle: the bridge it installs must exist before the renderer
 * looks for it. The title and pre-boot background come from the pack, playing
 * the role the BrowserWindow title/backgroundColor play on desktop. No CSP is
 * baked in — the desktop network restriction is meaningless for a game that
 * is itself served over HTTP(S); hosts that want one set it as a header.
 */
export function buildWebIndexHtml(
    pack: GameRuntimePackV1,
    options: { hasFavicon: boolean; variant?: GameWebShellVariant },
): string {
    const title = escapeHtml(pack.project.name?.trim() || "NarraLeaf Game");
    // Guaranteed markup-safe: a #rrggbb hex or a bare lowercase color name.
    const background = resolveGameRuntimeInitialBackgroundColor(pack);
    const faviconLink = options.hasFavicon
        ? `    <link rel="icon" type="image/png" href="./${WEB_FAVICON_FILENAME}" />\n`
        : "";
    // viewport-fit=cover lets the game paint under a notch/home indicator
    // instead of being letterboxed by the browser's default safe-area inset;
    // the shells run full-screen, so the inset would show as bars.
    const viewport = options.variant === "mobile"
        ? "width=device-width, initial-scale=1.0, viewport-fit=cover"
        : "width=device-width, initial-scale=1.0";
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="${viewport}" />
    <title>${title}</title>
    <script type="importmap">
    {
        "imports": {
            "narraleaf-studio/runtime": "./plugin-api/runtime.js",
            "react": "./plugin-api/react.js",
            "react-dom": "./plugin-api/react-dom.js",
            "react/jsx-runtime": "./plugin-api/react-jsx-runtime.js",
            "react/jsx-dev-runtime": "./plugin-api/react-jsx-dev-runtime.js"
        }
    }
    </script>
${faviconLink}    <link rel="stylesheet" href="./renderer.css" />
    <style>html, body { margin: 0; background: ${background}; }</style>
</head>
<body>
    <div id="root"></div>
    <script src="./web.js"></script>
    <script defer src="./renderer.js"></script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
