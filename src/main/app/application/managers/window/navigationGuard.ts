import path from "path";
import { fileURLToPath } from "url";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { WindowAppType } from "@shared/types/window";

export type NavigationDecision =
    | { allowed: true }
    | { allowed: false; reason: string };

export type WindowNavigationRequest = {
    url: string;
    currentUrl?: string;
    isMainFrame: boolean;
    windowType: WindowAppType;
    appEntryPath: string;
};

export function decideWindowNavigation(request: WindowNavigationRequest): NavigationDecision {
    const target = parseUrl(request.url);
    if (!target) {
        return deny("Invalid navigation URL");
    }

    if (isSameDocumentNavigation(request.currentUrl, target)) {
        return { allowed: true };
    }

    if (!request.isMainFrame) {
        return isBlankDocument(target)
            ? { allowed: true }
            : deny("Subframe navigation is not allowed");
    }

    if (isOwnFileEntry(target, request.appEntryPath)) {
        return { allowed: true };
    }

    if (isOwnAppWindowEntry(target, request.windowType)) {
        return { allowed: true };
    }

    return deny("Main frame navigation is restricted to the window application entry");
}

function parseUrl(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

function deny(reason: string): NavigationDecision {
    return { allowed: false, reason };
}

function isBlankDocument(url: URL): boolean {
    return url.href === "about:blank";
}

function isSameDocumentNavigation(currentUrl: string | undefined, target: URL): boolean {
    if (!currentUrl) {
        return false;
    }

    const current = parseUrl(currentUrl);
    if (!current) {
        return false;
    }

    current.hash = "";
    const normalizedTarget = new URL(target.href);
    normalizedTarget.hash = "";
    return current.href === normalizedTarget.href;
}

function isOwnFileEntry(url: URL, appEntryPath: string): boolean {
    if (url.protocol !== "file:") {
        return false;
    }

    try {
        return path.resolve(fileURLToPath(url)) === path.resolve(appEntryPath);
    } catch {
        return false;
    }
}

function isOwnAppWindowEntry(url: URL, windowType: WindowAppType): boolean {
    if (url.protocol !== `${AppProtocol}:` || url.hostname !== AppHost.Windows) {
        return false;
    }

    const pathname = decodePathname(url.pathname);
    if (!pathname) {
        return false;
    }

    return path.posix.normalize(pathname) === `/${windowType}/index.html`;
}

function decodePathname(pathname: string): string | null {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return null;
    }
}
