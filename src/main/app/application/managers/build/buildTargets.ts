import {
    GAME_BUILD_FORMATS_BY_PLATFORM,
    isDesktopBuildPlatform,
    isMobileBuildPlatform,
    type GameBuildDesktopPlatform,
    type GameBuildMobilePlatform,
    type GameBuildTarget,
} from "@shared/types/gameBuild";

export type GameBuildDesktopTarget = GameBuildTarget & { platform: GameBuildDesktopPlatform };
export type GameBuildMobileTarget = GameBuildTarget & { platform: GameBuildMobilePlatform };

export function isDesktopTarget(target: GameBuildTarget): target is GameBuildDesktopTarget {
    return isDesktopBuildPlatform(target.platform);
}
export function isMobileTarget(target: GameBuildTarget): target is GameBuildMobileTarget {
    return isMobileBuildPlatform(target.platform);
}

/** One interpretation of a selection, shared by preflight and execution. */
export function resolveBuildTargets(selection: readonly GameBuildTarget[] | undefined) {
    const selected: readonly GameBuildTarget[] = Array.isArray(selection) ? selection : [];
    const targets: GameBuildTarget[] = selected.map(target => ({
        platform: target.platform,
        formats: [...new Set(target.formats)],
        ...(target.arch ? { arch: target.arch } : {}),
    })).filter(target => target.formats.length > 0);
    const desktopTargets = targets.filter(isDesktopTarget);
    const mobileTargets = targets.filter(isMobileTarget);
    const webTarget = targets.find(target => target.platform === "web");
    const webFormats = webTarget?.formats.filter(format => GAME_BUILD_FORMATS_BY_PLATFORM.web.includes(format)) ?? [];
    const unknownTargets = targets.filter(target =>
        !isDesktopTarget(target) && !isMobileTarget(target) && target.platform !== "web",
    );
    return { targets, desktopTargets, mobileTargets, webTarget, webFormats, unknownTargets };
}
