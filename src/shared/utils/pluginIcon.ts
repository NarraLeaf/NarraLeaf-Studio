import {
    PLUGIN_ICON_EXTENSIONS,
    PLUGIN_ICON_MAX_BYTES,
    PLUGIN_ICON_MAX_DIMENSION,
    PLUGIN_ICON_MIN_DIMENSION,
    type PluginIconExtension,
} from "../constants/pluginIcon";
import { readImageDimensions, type ImageFormat } from "./imageDimensions";

/**
 * The declared extension of an icon path, or `null` when it is not one Studio
 * accepts. Case-insensitive: authors ship `Icon.PNG`.
 */
export function pluginIconExtension(iconPath: string): PluginIconExtension | null {
    const dot = iconPath.lastIndexOf(".");
    if (dot < 0) {
        return null;
    }
    const extension = iconPath.slice(dot + 1).toLowerCase();
    return PLUGIN_ICON_EXTENSIONS.includes(extension as PluginIconExtension)
        ? (extension as PluginIconExtension)
        : null;
}

/** Human list for error messages: `.png, .webp, .jpg, .jpeg`. */
export function pluginIconExtensionList(): string {
    return PLUGIN_ICON_EXTENSIONS.map(extension => `.${extension}`).join(", ");
}

const FORMAT_OF_EXTENSION: Record<PluginIconExtension, ImageFormat> = {
    png: "png",
    webp: "webp",
    jpg: "jpeg",
    jpeg: "jpeg",
};

/**
 * Check an icon's actual bytes against the shipping rules, returning an error
 * message or `null` when it passes.
 *
 * The manifest can only be checked for *shape* (a safe relative path with an
 * allowed extension); everything that matters about an icon — that it is really
 * an image, of the format its name claims, square, and small — lives in the
 * file. Both halves have to hold, which is why a plugin whose icon fails here
 * fails to install rather than quietly falling back to its monogram: a broken
 * icon is a broken package, and a package that installs "successfully" while
 * silently dropping part of itself is the harder bug to find later.
 */
export function validatePluginIconBytes(bytes: Uint8Array, iconPath: string): string | null {
    const extension = pluginIconExtension(iconPath);
    if (!extension) {
        return `Plugin icon must be one of: ${pluginIconExtensionList()}`;
    }
    if (bytes.byteLength > PLUGIN_ICON_MAX_BYTES) {
        return `Plugin icon must be at most ${Math.floor(PLUGIN_ICON_MAX_BYTES / 1024)} KB`;
    }
    const probe = readImageDimensions(bytes);
    if (!probe) {
        return `Plugin icon "${iconPath}" is not a readable ${extension.toUpperCase()} image`;
    }
    // A file named .png that decodes as something else is either a mistake or an
    // attempt to smuggle a format past the extension allowlist.
    if (probe.format !== FORMAT_OF_EXTENSION[extension]) {
        return `Plugin icon "${iconPath}" is a ${probe.format.toUpperCase()} file with a .${extension} name`;
    }
    if (probe.width !== probe.height) {
        return `Plugin icon must be square (got ${probe.width}x${probe.height})`;
    }
    if (probe.width > PLUGIN_ICON_MAX_DIMENSION) {
        return `Plugin icon must be at most ${PLUGIN_ICON_MAX_DIMENSION}x${PLUGIN_ICON_MAX_DIMENSION} (got ${probe.width}x${probe.height})`;
    }
    if (probe.width < PLUGIN_ICON_MIN_DIMENSION) {
        return `Plugin icon must be at least ${PLUGIN_ICON_MIN_DIMENSION}x${PLUGIN_ICON_MIN_DIMENSION} (got ${probe.width}x${probe.height})`;
    }
    return null;
}
