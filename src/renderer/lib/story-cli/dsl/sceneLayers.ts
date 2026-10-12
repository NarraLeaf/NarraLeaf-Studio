/**
 * The scene's layers, as header directives: one `#layer` line per layer, front to back.
 *
 * A layer belongs to its scene, not to a row (`StoryScene.layers`): the scene puts up every layer it
 * has before its first row runs. So a `.story` file states them where it states the scene's other
 * settings, in the header, and the rows below name them.
 *
 * ## The grammar
 *
 *     #layer <name> [follow=30%]    one of the scene's own layers
 *     #layer displayableLayer       the characters' layer
 *     #layer backgroundLayer [follow=0%]
 *
 * The lines are the stack in order, nearest first. `follow=` is how much of the camera's movement the
 * layer follows - a percentage, or a share (`follow=0.3`) - and a line that leaves it out follows all
 * of it. A layer can follow no more than the one in front of it; a line that says otherwise is moved
 * to its neighbour's share, and the check says so.
 *
 * ## A file that states no `#layer` changes nothing
 *
 * The rule the other settings follow. `story show` prints the lines only for a scene with layers of
 * its own, so a file printed from a scene without them, or written from nothing, leaves the scene's
 * layers as they are. A file that states them states the whole stack: a layer it leaves out is
 * removed, and a name the scene does not have yet is a new layer.
 *
 * Comments in English per project convention.
 */

import type { StoryScene, StorySceneLayer } from "@shared/types/story";
import {
    findSceneLayerByName,
    isDefaultSceneLayerStack,
    normalizeSceneLayerStack,
    sceneLayerFollow,
    sceneLayerNameProblem,
    sceneLayerStack,
    STORY_LAYER_FOLLOW_MAX,
} from "@shared/types/story";
import { errorAt, warningAt, type StoryFileDiagnostic } from "./ast";
import type { SceneSettingDirective } from "./sceneSettings";

export const DIRECTIVE_LAYER = "#layer";

/** The words the built-in layers are written with, as on the command line. */
const DISPLAYABLE_WORD = "displayableLayer";
const BACKGROUND_WORD = "backgroundLayer";

function quoteIfNeeded(name: string): string {
    if (/^[^\s"'=]+$/.test(name)) {
        return name;
    }
    return name.includes("'") ? JSON.stringify(name) : `'${name}'`;
}

/** The `#layer` lines for `scene`, nearest first; none when it has no layers of its own. */
export function printSceneLayers(scene: StoryScene): string[] {
    const stack = sceneLayerStack(scene);
    if (isDefaultSceneLayerStack(stack)) {
        return [];
    }
    return stack.map(layer => {
        const word = layer.kind === "custom" ? quoteIfNeeded(layer.name) : layer.kind === "displayable" ? DISPLAYABLE_WORD : BACKGROUND_WORD;
        const follow = sceneLayerFollow(layer);
        return follow === 1 || layer.kind === "displayable"
            ? `${DIRECTIVE_LAYER} ${word}`
            : `${DIRECTIVE_LAYER} ${word} follow=${Math.round(follow * 100)}%`;
    });
}

/** `#layer` arguments: the name (bare, or quoted when it has spaces) and `key=value` settings. */
function tokenize(text: string): string[] | null {
    const tokens: string[] = [];
    let index = 0;
    while (index < text.length) {
        if (/\s/.test(text[index])) {
            index += 1;
            continue;
        }
        let token = "";
        while (index < text.length && !/\s/.test(text[index])) {
            const quote = text[index];
            if (quote === "'" || quote === "\"") {
                const end = text.indexOf(quote, index + 1);
                if (end < 0) {
                    return null;
                }
                token += text.slice(index + 1, end);
                index = end + 1;
                continue;
            }
            token += text[index];
            index += 1;
        }
        tokens.push(token);
    }
    return tokens;
}

/** A `follow=` value as a share: `30%`, or `0.3`. Null when it is neither, or out of range. */
function readFollow(value: string): number | null {
    const percent = value.endsWith("%");
    const amount = Number(percent ? value.slice(0, -1) : value);
    if (value.trim() === "" || !Number.isFinite(amount)) {
        return null;
    }
    const share = percent ? amount / 100 : amount;
    return share >= 0 && share <= STORY_LAYER_FOLLOW_MAX ? share : null;
}

/**
 * `scene` with the stack the file's `#layer` lines state, or as it was when the file states none. A
 * layer keeps its id when a line names it, so every row bound to it stays bound; a line naming no
 * layer the scene has makes a new one.
 */
export function applySceneLayerDirectives(
    scene: StoryScene,
    directives: readonly SceneSettingDirective[] | undefined,
    mintId: () => string,
): { scene: StoryScene; diagnostics: StoryFileDiagnostic[] } {
    const diagnostics: StoryFileDiagnostic[] = [];
    if (!directives || directives.length === 0) {
        return { scene, diagnostics };
    }
    const stated: StorySceneLayer[] = [];
    let refused = false;
    for (const directive of directives) {
        const tokens = tokenize(directive.value);
        if (!tokens || tokens.length === 0) {
            diagnostics.push(errorAt("file.bad_setting", `${DIRECTIVE_LAYER} takes a layer name (quoted when it has spaces) and an optional follow=.`, directive.line));
            refused = true;
            continue;
        }
        let follow: number | undefined;
        for (const token of tokens.slice(1)) {
            const [key, value = ""] = token.split("=", 2);
            const share = key === "follow" ? readFollow(value) : null;
            if (share === null) {
                diagnostics.push(errorAt(
                    "file.bad_setting",
                    `"${token}" is not a ${DIRECTIVE_LAYER} setting. It takes follow=, a percentage from 0% to ${STORY_LAYER_FOLLOW_MAX * 100}%.`,
                    directive.line,
                ));
                refused = true;
                continue;
            }
            follow = share;
        }
        const word = tokens[0];
        if (word === DISPLAYABLE_WORD) {
            stated.push({ kind: "displayable" });
            continue;
        }
        if (word === BACKGROUND_WORD) {
            stated.push(follow === undefined ? { kind: "background" } : { kind: "background", follow });
            continue;
        }
        const problem = sceneLayerNameProblem(stated, word);
        if (problem !== null) {
            diagnostics.push(errorAt(
                "file.bad_setting",
                problem === "taken"
                    ? `${DIRECTIVE_LAYER} ${word}: a second layer with this name. Each layer of a scene has its own name.`
                    : `${DIRECTIVE_LAYER} ${word}: this word names a built-in layer; write it on its own, without settings for a layer of the scene's own.`,
                directive.line,
            ));
            refused = true;
            continue;
        }
        const existing = findSceneLayerByName(scene, word);
        stated.push({ kind: "custom", id: existing?.id ?? mintId(), name: word, ...(follow === undefined ? {} : { follow }) });
    }
    if (refused) {
        return { scene, diagnostics };
    }
    const stack = normalizeSceneLayerStack(stated);
    stated.forEach(layer => {
        const settled = stack.find(entry => entry.kind === layer.kind && (entry.kind !== "custom" || (layer.kind === "custom" && entry.id === layer.id)));
        if (settled && layer.kind !== "displayable" && sceneLayerFollow(settled) !== sceneLayerFollow(layer)) {
            const line = directives.find(directive => directive.value.trim().startsWith(layer.kind === "custom" ? layer.name : BACKGROUND_WORD))?.line;
            diagnostics.push(warningAt(
                "file.layer_follow_adjusted",
                `${DIRECTIVE_LAYER} ${layer.kind === "custom" ? layer.name : BACKGROUND_WORD}: a layer follows no more of the camera than the one in front of it, `
                    + `so it follows ${Math.round(sceneLayerFollow(settled) * 100)}% here.`,
                line,
            ));
        }
    });
    const { layers: _layers, ...rest } = scene;
    return { scene: isDefaultSceneLayerStack(stack) ? rest : { ...rest, layers: stack }, diagnostics };
}
