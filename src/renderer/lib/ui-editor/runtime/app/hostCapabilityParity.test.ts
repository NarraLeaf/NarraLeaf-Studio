/**
 * What a game can do in Dev Mode is what it can do in the build.
 *
 * ## The seam
 *
 * `GameHostCapabilities` makes every capability mandatory to *write*, which is what stopped one
 * surface of a game from having a capability another lacked (see `gameHostApiOptions`). It cannot
 * stop a whole HOST from lacking one: nearly every field of {@link GameAppHost} is optional,
 * because a host really can have no window and no filesystem, so leaving one out compiles and the
 * nodes report the honest absence. Between two hosts of the same game that is not honesty - it is
 * "it worked in Dev Mode", the promise a shipped build then fails to keep.
 *
 * It went both ways. Dev Mode had no ending page, so a story that ran off the end stopped where it
 * was there and moved to a page in the build. Dev Mode could not size its stage, so the size row of
 * an author's own configuration screen was empty in the only window they could test it in, and
 * populated in the game they shipped.
 *
 * ## What this checks
 *
 * Every optional member of `GameAppHost`, in the two hosts that run a whole game - the Dev Mode
 * window and the packaged runtime shell - has to be set by both, or be named below with the reason
 * only one of them has it. The scene editor's story preview is not a whole game (one scene, in a
 * Studio panel, with no window and no playthrough), so it is held to its own list: the capabilities
 * it writes `undefined` for.
 *
 * Read as source text because these are React `useMemo` bodies rather than values a test can build:
 * constructing one needs a running game around it. That is also why the counts below are asserted -
 * a rename that stopped the scan matching would otherwise pass with nothing examined.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HERE = path.resolve(__dirname);
const REPO = path.resolve(HERE, "../../../../../..");
const HOST_TYPE = path.join(HERE, "GameAppHost.ts");
const DEV_MODE_HOST = path.join(REPO, "src/renderer/apps/dev-mode/components/DevModeContent.tsx");
const RUNTIME_HOST = path.join(REPO, "src/runtime/renderer/GameRuntimeApp.tsx");
const STORY_PREVIEW_HOST = path.join(
    REPO,
    "src/renderer/apps/workspace/modules/story/scene-editor/preview/useStoryPreviewGameUi.ts",
);

/** The brace-matched body of a declaration, from the first `{` after `marker`. */
function bracedBody(source: string, marker: string): string {
    const at = source.indexOf(marker);
    if (at < 0) {
        throw new Error(`not found where this test expects it: ${marker}`);
    }
    let depth = 0;
    for (let index = source.indexOf("{", at); index < source.length; index += 1) {
        const character = source[index];
        if (character === "{" || character === "(" || character === "[") {
            depth += 1;
        } else if (character === "}" || character === ")" || character === "]") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(at, index + 1);
            }
        }
    }
    throw new Error(`unterminated body: ${marker}`);
}

/**
 * The optional members of `GameAppHost`.
 *
 * Depth-aware, because the type nests object literals of its own and a member of one of those is
 * not a capability a host answers for. Read from the declaration rather than repeated here, so a
 * capability added to the host is a capability this test starts requiring on the same edit.
 */
function optionalHostMembers(source: string): string[] {
    const body = bracedBody(source, "export type GameAppHost = {");
    const members: string[] = [];
    let depth = 0;
    for (let index = 0; index < body.length; index += 1) {
        const character = body[index]!;
        if (character === "/" && body[index + 1] === "/") {
            index = body.indexOf("\n", index);
            if (index < 0) break;
            continue;
        }
        if (character === "/" && body[index + 1] === "*") {
            index = body.indexOf("*/", index) + 1;
            continue;
        }
        if (character === '"' || character === "'" || character === "`") {
            const quote = character;
            index += 1;
            while (index < body.length && body[index] !== quote) {
                if (body[index] === "\\") index += 1;
                index += 1;
            }
            continue;
        }
        if (character === "{" || character === "(" || character === "[") {
            depth += 1;
            continue;
        }
        if (character === "}" || character === ")" || character === "]") {
            depth -= 1;
            continue;
        }
        if (depth === 1 && /[A-Za-z_$]/.test(character)) {
            let end = index;
            while (end < body.length && /[A-Za-z0-9_$]/.test(body[end]!)) end += 1;
            if (body.slice(end, end + 2) === "?:") {
                members.push(body.slice(index, end));
            }
            index = end - 1;
        }
    }
    return members;
}

/**
 * Whether a host literal sets a member.
 *
 * Text rather than structure, and `[:,}]` because a value bound from a name of its own is written
 * shorthand - with a closing brace after it when it is the last of a group. It also has to see
 * through a conditional spread: the packaged shell contributes the menu pair only when its bridge
 * has a menu, which is a nested literal and still a capability that host answers for.
 */
function sets(literal: string, member: string): boolean {
    return new RegExp(`\\b${member}\\s*[:,}]`).test(literal);
}

/**
 * Capabilities only the Dev Mode window has, and why the packaged game does not.
 *
 * Every one of them is a fact about the WINDOW rather than about the game: an author is reading
 * their project in it. None of them changes what a graph can do, which is the line - a capability
 * an author's nodes can reach does not belong on this list.
 */
const DEV_MODE_ONLY: Readonly<Record<string, string>> = {
    debuggerEnabled:
        "Breakpoints. A shipped game must not be able to stop at a node.",
    reportIssue:
        "Failures located against the author's story. It needs the project open to point into; the "
        + "packaged game logs the same failures, which is all a player's machine can do with them.",
    prewarmStoryAssetUrls:
        "Resolving the whole asset library in one round trip. Dev Mode asks another window and pays "
        + "for the trip; the packaged game reads its own pack and has nothing to prepare.",
    launchRequest:
        "Start this story now, at this row, in the window that is already open. It exists because "
        + "the author pressed a play control in the editor beside it; a shipped game is started by "
        + "being opened, so a launch there is a boot and there is nobody to ask for another one.",
    surfacesBeforeStoryBoot:
        "Draw the interface before the story is warm. A shipped game holds its loading screen until "
        + "the opening scene is warm, which is what makes Start Game instant; Dev Mode trades that "
        + "for showing the interface a second in rather than three.",
};

/**
 * Capabilities only the packaged game has, and why the Dev Mode window does not.
 *
 * The bar is the same and it is higher than "nobody wired it up": each of these is something the
 * Dev Mode window cannot honestly do, because the window is Studio's and the author is working in
 * it rather than playing. A capability that merely has not been wired yet belongs in Dev Mode, not
 * here - that is the whole subject of this file.
 */
const RUNTIME_ONLY: Readonly<Record<string, string>> = {
    setDisplayAwake:
        "Hold the display awake while the story advances on its own. Dev Mode is a window inside "
        + "the editor, and a session left running on auto must not stop the author's machine "
        + "sleeping. Nothing reads it back, so no graph can tell the difference.",
    setApplicationMenu:
        "A menu bar on the shell's window. The Dev Mode window is Studio's and already carries "
        + "Studio's menu, so there is no bar to hang the author's on.",
    subscribeMenuCommand:
        "The other half of the menu bar. Both or neither: a bar nobody hears from is a row of words "
        + "that do nothing.",
};

/**
 * What the scene editor's story preview cannot do, capability by capability.
 *
 * A list rather than a rule, because the preview is the one host that is legitimately not a game: a
 * Studio panel showing one scene, with no window, no playthrough, no navigation stack and no
 * project dub loaded. Written out so that a capability it stops answering - or one added to the
 * bridge and answered `undefined` here out of habit - is a decision someone makes on purpose.
 */
const STORY_PREVIEW_ABSENT: readonly string[] = [
    // No navigation stack: the preview draws one scene rather than a stack of surfaces.
    "onClearPages",
    "onClearGameOverlay",
    // No window of its own; it renders into a Studio panel.
    "onGetWindowScaleOptions",
    "onGetWindowScale",
    "onSetWindowScale",
    "onGetWindowSize",
    "onSetWindowSize",
    // Layers belong to the surface stack a game app owns.
    "onShowLayer",
    "onHideLayer",
    "onHideLayerGroup",
    "onWaitLayer",
    "onCloseOwnLayer",
    "onIsLayerMounted",
    // No playthrough to capture, save, or carry between builds.
    "onCaptureRun",
    "onReadSaveGame",
    "onIsCurrentTextRead",
    "onIsTextRead",
    "onClearTextRead",
    "onIsSceneVisited",
    "onIsOptionPicked",
    "onClearVisited",
    "onIsEndingReached",
    "onIsDlcInstalled",
    "onListEndings",
    "onClearEndingState",
    "onClearEndings",
    "onExportProgress",
    "onImportProgress",
    "onStorageDurability",
    // No audio transport: the preview shows a scene rather than playing one.
    "onPlaySound",
    "onStopSound",
    "onPauseSound",
    "onResumeSound",
    "onSetSoundVolume",
    "onSeekSound",
    "onIsSoundPlaying",
    "onGetTrackVolume",
    "onSetTrackVolume",
    "audioTracks",
    "onPlayVoice",
    "onPlayChoiceVoice",
    // Nowhere to send a request that leaves the page: no main process answers for this panel.
    "onNetworkFetch",
    "onMovePointer",
    "onOpenExternal",
    // No preference store and no locale of its own; the panel follows the editor.
    "onSubscribeGamePreferences",
    "onLocaleChanged",
];

describe("Dev Mode and the shipped game are the same host", () => {
    const hostType = fs.readFileSync(HOST_TYPE, "utf8");
    const optional = optionalHostMembers(hostType);
    const devMode = bracedBody(fs.readFileSync(DEV_MODE_HOST, "utf8"), "const host = useMemo<GameAppHost | null>");
    const runtime = bracedBody(fs.readFileSync(RUNTIME_HOST, "utf8"), "const host = useMemo<GameAppHost | null>");

    it("reads both hosts and the whole capability surface", () => {
        // Non-vacuous. A renamed host binding or a moved type would leave every assertion below
        // comparing two empty sets, which is the shape of a guard that has quietly stopped.
        expect(optional.length, "GameAppHost declares no optional members").toBeGreaterThan(20);
        expect(devMode.length, "the Dev Mode host was not read").toBeGreaterThan(400);
        expect(runtime.length, "the packaged runtime host was not read").toBeGreaterThan(400);
    });

    it("gives the Dev Mode window every capability the shipped game has", () => {
        const missing = optional
            .filter(member => sets(runtime, member) && !sets(devMode, member))
            .filter(member => !(member in RUNTIME_ONLY));

        expect(
            missing,
            "the packaged game answers these and the Dev Mode window does not, so an author cannot "
            + "see them work in the window they test in - and the ones that are absent on purpose "
            + "belong in RUNTIME_ONLY with the reason:\n" + missing.join("\n"),
        ).toEqual([]);
    });

    it("gives the shipped game every capability the Dev Mode window has", () => {
        const missing = optional
            .filter(member => sets(devMode, member) && !sets(runtime, member))
            .filter(member => !(member in DEV_MODE_ONLY));

        expect(
            missing,
            "the Dev Mode window answers these and the packaged game does not, which is the "
            + "dangerous direction: it works while the author is testing and is silently gone in "
            + "the game they ship. Ones that are Dev Mode's on purpose belong in DEV_MODE_ONLY "
            + "with the reason:\n" + missing.join("\n"),
        ).toEqual([]);
    });

    it("keeps the two allowlists true", () => {
        // An allowlist outlives the thing it excused. These entries claim one host has a capability
        // and the other does not; when that stops being so, the entry is what has to go.
        const stale: string[] = [];
        for (const member of Object.keys(DEV_MODE_ONLY)) {
            if (!sets(devMode, member)) stale.push(`${member}: the Dev Mode host no longer sets it`);
            if (sets(runtime, member)) stale.push(`${member}: the packaged game sets it now too`);
        }
        for (const member of Object.keys(RUNTIME_ONLY)) {
            if (!sets(runtime, member)) stale.push(`${member}: the packaged game no longer sets it`);
            if (sets(devMode, member)) stale.push(`${member}: the Dev Mode host sets it now too`);
        }
        for (const member of [...Object.keys(DEV_MODE_ONLY), ...Object.keys(RUNTIME_ONLY)]) {
            if (!optional.includes(member)) stale.push(`${member}: GameAppHost has no such member`);
        }
        expect(stale, "these exemptions describe a state that no longer exists:\n" + stale.join("\n"))
            .toEqual([]);
    });
});

describe("the story preview says what it cannot do", () => {
    const source = fs.readFileSync(STORY_PREVIEW_HOST, "utf8");
    const capabilities = bracedBody(source, "const hostCapabilities: GameHostCapabilities = {");
    const absent = [...capabilities.matchAll(/(\w+):\s*undefined,/g)].map(match => match[1]!);

    it("declares exactly the capabilities it is allowed to be without", () => {
        expect(absent.length, "the story preview host was not read").toBeGreaterThan(20);

        const unexpected = absent.filter(name => !STORY_PREVIEW_ABSENT.includes(name));
        const recovered = STORY_PREVIEW_ABSENT.filter(name => !absent.includes(name));

        expect(
            unexpected,
            "the story preview stopped answering these. It is the one host that is legitimately not "
            + "a game, but each absence is a node that quietly reports nothing - so add it to "
            + "STORY_PREVIEW_ABSENT with the reason, or answer it:\n" + unexpected.join("\n"),
        ).toEqual([]);
        expect(
            recovered,
            "the story preview answers these now, so the list saying it cannot is out of date:\n"
            + recovered.join("\n"),
        ).toEqual([]);
    });
});
