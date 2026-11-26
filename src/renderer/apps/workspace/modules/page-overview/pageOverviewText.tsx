import type { ReactNode } from "react";
import type { TranslationKey } from "@shared/i18n";
import type { UseTranslation } from "@/lib/i18n";
import type { PageOverviewExit, PageOverviewTarget } from "./pageOverviewModel";
import type { OverviewDestination } from "./pageOverviewLayout";

/** What the overview needs to put names to things: pages by id, stories and scenes by id. */
export type OverviewNames = {
    pageName: (surfaceId: string) => string | null;
    storyName: (storyId: string, sceneId: string | null) => string | null;
};

type T = UseTranslation["t"];

/** How a destination is named in its box and inside a sentence. */
export function destinationName(target: PageOverviewTarget, verb: PageOverviewExit["verb"], names: OverviewNames, t: T): string {
    switch (target.kind) {
        case "page":
            return target.missing ? t("uiEditor.pageOverview.target.missingPage") : names.pageName(target.surfaceId) ?? target.surfaceId;
        case "story":
            return names.storyName(target.storyId, target.sceneId) ?? t("uiEditor.pageOverview.target.unknownStory");
        case "stackRoot":
            return t("uiEditor.pageOverview.target.stackRoot");
        case "dynamic":
            return t("uiEditor.pageOverview.target.dynamic");
        case "unset":
            return t("uiEditor.pageOverview.target.unset");
        case "function":
            return target.name ?? t("uiEditor.pageOverview.target.unnamedFunction");
        case "none":
            if (verb === "goBack") {
                return t("uiEditor.pageOverview.target.back");
            }
            if (verb === "closeLayer") {
                return t("uiEditor.pageOverview.target.closeLayer");
            }
            return t("uiEditor.pageOverview.target.quitApp");
    }
}

/** The small word beside a destination's name saying what kind of place it is. */
export function destinationKind(destination: OverviewDestination, t: T): string {
    switch (destination.target.kind) {
        case "page":
        case "stackRoot":
            return t("uiEditor.pageOverview.target.pageKind");
        case "story":
            return t("uiEditor.pageOverview.target.storyKind");
        case "dynamic":
            return t("uiEditor.pageOverview.target.dynamicKind");
        case "unset":
            return t("uiEditor.pageOverview.target.unsetKind");
        case "function":
            return t("uiEditor.pageOverview.target.functionKind");
        case "none":
            return t("uiEditor.pageOverview.target.endKind");
    }
}

/** A second line under the name, for the boxes whose name alone does not say enough. */
export function destinationNote(destination: OverviewDestination, t: T): string | null {
    switch (destination.target.kind) {
        case "dynamic":
            return t("uiEditor.pageOverview.target.dynamicSub");
        case "unset":
            return t("uiEditor.pageOverview.target.unsetSub");
        case "stackRoot":
            return t("uiEditor.pageOverview.target.stackRootSub");
        case "function":
            return t("uiEditor.pageOverview.target.functionSub");
        default:
            return null;
    }
}

const EXIT_KEYS: Record<PageOverviewExit["verb"], TranslationKey> = {
    goPage: "uiEditor.pageOverview.exit.goPage",
    replacePage: "uiEditor.pageOverview.exit.replacePage",
    showLayer: "uiEditor.pageOverview.exit.showLayer",
    showConfirm: "uiEditor.pageOverview.exit.showConfirm",
    startGame: "uiEditor.pageOverview.exit.startGame",
    quitGame: "uiEditor.pageOverview.exit.quitGame",
    goBack: "uiEditor.pageOverview.exit.goBack",
    closeLayer: "uiEditor.pageOverview.exit.closeLayer",
    quitApp: "uiEditor.pageOverview.exit.quitApp",
    callFunction: "uiEditor.pageOverview.exit.callFunction",
};

/** Stands in for the target inside a translated sentence, so the name can be set apart. */
const SLOT = "\u0001";

/**
 * One exit as a phrase - "opens Settings" - with the target set in its own weight, and in the
 * warning colour when it is not a real place yet (decided while running, not picked, deleted).
 */
export function ExitPhrase({ exit, names, t }: { exit: PageOverviewExit; names: OverviewNames; t: T }): ReactNode {
    const sentence = t(EXIT_KEYS[exit.verb], { target: SLOT });
    const [before, after] = sentence.includes(SLOT) ? sentence.split(SLOT) : [sentence, null];
    if (after === null) {
        return <span>{before}</span>;
    }
    const target = exit.target;
    const uncertain = target.kind === "dynamic" || target.kind === "unset" || (target.kind === "page" && target.missing);
    return (
        <span>
            {before}
            <span className={uncertain ? "font-medium text-warning" : "font-medium text-fg"}>
                {destinationName(target, exit.verb, names, t)}
            </span>
            {after}
        </span>
    );
}
