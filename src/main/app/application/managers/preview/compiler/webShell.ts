import fs from "fs/promises";
import path from "path";
import { WEB_SHELL_VARIANT_META, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveGameRuntimeInitialBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";
import { networkAllowlistCspSources, packNetworkAllowlist } from "@shared/types/networkAllowlist";
import {
  PLUGIN_REACT_MODULE_SOURCES,
  PLUGIN_RUNTIME_API_MODULE_SOURCE
} from "@shared/utils/pluginRuntimeApiModule";

/**
 * Static web shell of an exported game. Where the desktop shell serves the
 * runtime through its own privileged protocol (custom scheme, in-memory
 * plugin-api modules, CSP injected at serve time), the web export has no
 * process of its own - everything the browser needs must exist as a plain
 * file with a relative URL. This module emits those files next to the shared
 * renderer bundle: the entry document and the plugin-api ESM shims.
 *
 * The CSP is the one thing that survived that translation, and only half of it.
 * A page served over HTTP(S) is on the network by construction, so there is
 * nothing here for the desktop shell's "app protocol only" policy to mean - but
 * a project that narrowed itself to an allowlist stated a fact about the build
 * rather than about the desktop, and `connect-src` is the only thing on this
 * shell that can hold it. It is also the only layer that reaches code the game's
 * own bridge never sees, a plugin's runtime calling `fetch` being exactly that.
 */

export const WEB_FAVICON_FILENAME = "favicon.png";

/**
 * iOS ignores `rel="icon"` entirely: a game added to the home screen from
 * Safari gets a screenshot of the page unless this file exists. It is baked
 * opaque for the same reason the iOS app icon is - Safari composites an icon
 * with an alpha channel onto black.
 */
export const WEB_APPLE_TOUCH_FILENAME = "apple-touch-icon.png";

/**
 * Which host the emitted entry document targets. The mobile shells serve the
 * very same site - only the entry document differs, and only in its viewport -
 * so the mobile variant is generated from the same pack and injected into the
 * repack, leaving the compiled site on disk exactly what the web target ships.
 */
export type GameWebShellVariant = "web" | "mobile";

export async function writeWebShellFiles(input: {
  appDir: string;
  pack: GameRuntimePackV1;
  hasFavicon: boolean;
  hasAppleTouchIcon: boolean;
}): Promise<void> {
  const pluginApiDir = path.join(input.appDir, "plugin-api");
  await fs.mkdir(pluginApiDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginApiDir, "runtime.js"),
    PLUGIN_RUNTIME_API_MODULE_SOURCE,
    "utf-8"
  );
  for (const [servedPath, source] of Object.entries(PLUGIN_REACT_MODULE_SOURCES)) {
    await fs.writeFile(path.join(pluginApiDir, servedPath.replace(/^\//, "")), source, "utf-8");
  }
  await fs.writeFile(
    path.join(input.appDir, "index.html"),
    buildWebIndexHtml(input.pack, {
      hasFavicon: input.hasFavicon,
      hasAppleTouchIcon: input.hasAppleTouchIcon
    }),
    "utf-8"
  );
}

/**
 * The exported entry document. All URLs are relative so the site works from
 * any host and any sub-path. web.js loads synchronously ahead of the deferred
 * renderer bundle: the bridge it installs must exist before the renderer
 * looks for it. The title and pre-boot background come from the pack, playing
 * the role the BrowserWindow title/backgroundColor play on desktop. A CSP is
 * baked in only when the project narrowed itself to an allowlist; otherwise
 * there is nothing to say that a served page does not already say, and hosts
 * that want a broader policy set one as a header.
 */
export function buildWebIndexHtml(
  pack: GameRuntimePackV1,
  options: { hasFavicon: boolean; hasAppleTouchIcon?: boolean; variant?: GameWebShellVariant }
): string {
  const title = escapeHtml(pack.project.name?.trim() || "NarraLeaf Game");
  // Guaranteed markup-safe: a #rrggbb hex or a bare lowercase color name.
  const background = resolveGameRuntimeInitialBackgroundColor(pack);
  const iconLinks = [
    options.hasFavicon
      ? `    <link rel="icon" type="image/png" href="./${WEB_FAVICON_FILENAME}" />\n`
      : "",
    options.hasAppleTouchIcon
      ? `    <link rel="apple-touch-icon" href="./${WEB_APPLE_TOUCH_FILENAME}" />\n`
      : ""
  ].join("");
  // viewport-fit=cover lets the game paint under a notch/home indicator
  // instead of being letterboxed by the browser's default safe-area inset;
  // the shells run full-screen, so the inset would show as bars.
  const viewport =
    options.variant === "mobile"
      ? "width=device-width, initial-scale=1.0, viewport-fit=cover"
      : "width=device-width, initial-scale=1.0";
  // The pack is built once and the mobile repack serves this same site, so the pack cannot say
  // which shell is running it — the entry document can, and it is already the one file that
  // differs. The stage crop is mobile-only, and this is what it reads.
  const shellMeta =
    options.variant === "mobile"
      ? `    <meta name="${WEB_SHELL_VARIANT_META}" content="mobile" />\n`
      : "";
  const cspMeta = buildWebCspMeta(pack);
  return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="${viewport}" />
${shellMeta}${cspMeta}
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
${iconLinks}    <link rel="stylesheet" href="./renderer.css" />
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

/**
 * The `<meta http-equiv>` CSP for a build that narrowed itself, or the empty string for one that
 * did not.
 *
 * Only the directives that can name a remote origin are constrained, and `script-src` is
 * deliberately not one of them - in either direction. It is not widened, because a host the author
 * listed may send this game data and that is not the same as sending it code; and it is not
 * narrowed to `'self'` either, because this shell serves plugin runtime modules and an import map
 * from the same origin as the page, and a stricter script policy here would be a new restriction
 * arriving under an unrelated setting.
 *
 * Origins, not paths: a `connect-src` source with a path is not carried across a redirect, and this
 * shell has no process behind it to hold the finer half. See `networkAllowlistCspSources`, which is
 * where that trade is written down.
 */
function buildWebCspMeta(pack: GameRuntimePackV1): string {
  const sources = networkAllowlistCspSources(packNetworkAllowlist(pack));
  if (sources === null) {
    return "";
  }
  const remote = sources.length > 0 ? " " + sources.join(" ") : "";
  const policy = [
    `default-src 'self' data: blob:${remote}`,
    `img-src 'self' data: blob:${remote}`,
    `media-src 'self' data: blob:${remote}`,
    `font-src 'self' data: blob:${remote}`,
    `connect-src 'self' data: blob:${remote}`,
    "object-src 'none'"
  ].join("; ");
  return `    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}" />\n`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
