import type {
    StoryActionPayload,
    StoryAnimationAsset,
    StoryBlock,
    StoryCharacterTagSelection,
    StoryConditionRef,
    StoryDocument,
    StoryLayerRef,
    StoryLiteralValue,
    StoryScene,
    StorySavedVariableDefinition,
    StorySceneVariableDefinition,
    StoryTransformRef,
    StoryVariableRef,
} from "@shared/types/story";
import { isStoryExpressionEvaluable, resolveDisplayableTargetRef, savedVariableDefs, sceneVariableDefs } from "@shared/types/story";
import type { SavedVariableRuntimeTable } from "@shared/types/variables/registry";
import { buildMergedVariableView, type MergedPersistentView } from "@shared/variables/mergedPersistentView";
import type { StoryExpressionEnv } from "@shared/utils/storyExpressionEval";
import { evaluateStoryExpression, isTruthy } from "@shared/utils/storyExpressionEval";
import { translate } from "@/lib/i18n";
import {
    getCharacterStageObjectName,
    getPresetPosition,
    mergeTransformProps,
    normalizeObjectName,
    storyTransformRefFinalProps,
    type VisibilityTransformMode,
} from "./storyTransformProps";

/**
 * Studio-side stage-state computation: walk a scene's blocks in execution order up to (but not
 * including) the target block and accumulate the settled visual state of the stage - background,
 * every displayable's final transform props and visibility, variables, and NVL mode. The preview
 * then renders this snapshot directly (pre-posed elements + the target action), so no runtime
 * fast-forwarding is ever needed.
 *
 * Semantics mirror the NLR story compiler exactly (same object-name keying, preset/animation
 * final-prop math, condition operators); approximations are surfaced as diagnostics.
 */

export type StageSnapshotDiagnostic = {
    level: "warning" | "error";
    blockId?: string;
    message: string;
};

export type StageSnapshotImageSource =
    | { type: "asset"; assetId: string }
    | { type: "color"; color: string }
    | { type: "character"; characterId?: string; pose?: string; tags?: StoryCharacterTagSelection };

/** Residual instant effects to re-apply on the pre-posed element ("clear" = the clear-op ran last). */
export type StageSnapshotEffects = {
    mask?: { assetId: string } | "clear";
    clip?: { clipPath: string } | "clear";
    filter?: { filter: string } | "clear";
    darkness?: number;
};

/**
 * The stage camera's settled pose (`/camera` pan/zoom/rotate/darken), accumulated up to the target
 * row. `null` means the camera is at its neutral pose (nothing to pre-pose). Structurally a sibling
 * of {@link StageSnapshotDisplayable}: `props` are pre-posed like any displayable's transform, and
 * `effects.darkness` re-applies through the same channel `/camera darken` drives at runtime.
 *
 * Scope caveat: the camera is a story-level singleton whose pose persists across scenes, but this
 * snapshot is computed per scene, so only the launch scene's own `/camera` rows are reconstructed -
 * a pose set in an earlier scene and carried across a `jump` is not.
 */
export type StageSnapshotCamera = {
    /**
     * Settled NLR transform props (position/zoom/rotation) - pre-posed via
     * setDisplayableTransformProps. A `/camera motion` row contributes its animation's settled end
     * state here, through the same `storyTransformRefFinalProps` a displayable's motion uses.
     */
    props: Record<string, unknown>;
    /** Camera darkness (0-1), the only `/camera` effect; re-applied as `camera.darken(d, 0)`. */
    effects: StageSnapshotEffects;
};

export type StageSnapshotDisplayable = {
    kind: "image" | "text" | "layer";
    /** Normalized object name - the compiler's element-registry key. */
    objectName: string;
    /** Block that created this displayable, when known (stable identity for editor lookups). */
    sourceBlockId?: string;
    visible: boolean;
    /** Settled transform props in NLR shape (position/opacity/zoom/scaleX/scaleY/rotation/...). */
    props: Record<string, unknown>;
    effects: StageSnapshotEffects;
    // image
    source?: StageSnapshotImageSource;
    autoFit?: boolean;
    layer?: StoryLayerRef;
    // text
    text?: string;
    fontSize?: number;
    fontColor?: string;
    // layer
    zIndex?: number;
};

export type StoryStageSnapshot = {
    background: { assetId?: string; color?: string } | null;
    /** Displayables in creation order. */
    displayables: StageSnapshotDisplayable[];
    /** Props accumulated against the built-in scene background image. */
    backgroundProps: Record<string, unknown>;
    backgroundEffects: StageSnapshotEffects;
    /** Props accumulated against the built-in layers. */
    builtinLayerProps: { backgroundLayer: Record<string, unknown>; displayableLayer: Record<string, unknown> };
    /** Explicitly-assigned variable values (storage key → value). */
    sceneVariables: Record<string, StoryLiteralValue>;
    savedVariables: Record<string, StoryLiteralValue>;
    /** Settled stage-camera pose accumulated within this scene, or null if neutral. */
    camera: StageSnapshotCamera | null;
    /** True when the target sits inside an NVL container. */
    nvl: boolean;
    diagnostics: StageSnapshotDiagnostic[];
};

/**
 * Lower bound on camera zoom (a zero/negative scale is a broken transform, not a shot). Mirrors the
 * compiler's `MIN_CAMERA_ZOOM`: the pose is pre-posed straight onto the camera, bypassing the
 * `compileCameraAction` clamp, so it must be clamped here too.
 */
const MIN_CAMERA_ZOOM = 0.05;

/** A finite number or the neutral fallback - a NaN reaching a Transform prop silently kills the animation. */
function finiteOr(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * "Every saved variable" for a runtime consumer: the project registry's `saved` entries unioned with
 * the story's own `/save` declaration rows. The view also carries the cross-surface name
 * collisions, which the compiler reports as diagnostics.
 *
 * Lives in this module rather than in the compiler because the compiler and this snapshot walk must
 * agree on which saved variables exist - if they ever diverged, the preview would seed a different
 * starting state than the game - and the dependency between them already runs compiler → snapshot.
 */
export function collectSavedVariableView(
    document: StoryDocument,
    savedVariables?: SavedVariableRuntimeTable,
): MergedPersistentView {
    return buildMergedVariableView(Object.values(savedVariables ?? {}), Object.values(savedVariableDefs(document)));
}

/**
 * Flatten a merged saved view into the `variableId → definition` table every resolver indexes.
 *
 * One flat table keyed by id is exact, not a compromise: a registry entry id and a story declaration
 * block id are both uuids minted by their own surface, so the two key spaces cannot collide and no
 * per-source prefixing is needed. A `StoryVariableRef` therefore resolves the same way whichever
 * surface declared the variable, which is the whole point of the registry scope.
 */
export function savedVariableDefsFromView(view: MergedPersistentView): Record<string, StorySavedVariableDefinition> {
    const defs: Record<string, StorySavedVariableDefinition> = {};
    for (const entry of view.entries) {
        defs[entry.id] = {
            id: entry.id,
            name: entry.name,
            valueType: entry.valueType,
            // Spread, never `defaultValue: entry.defaultValue`: "no default" and "default undefined"
            // are the same in TypeScript but not downstream - the seeding loop tells them apart.
            ...(entry.defaultValue === undefined ? {} : { defaultValue: entry.defaultValue }),
            storageKey: entry.storageKey,
        };
    }
    return defs;
}

export function computeStoryStageSnapshot(input: {
    document: StoryDocument;
    sceneId: string;
    targetBlockId: string | null;
    animations?: ReadonlyMap<string, StoryAnimationAsset> | Record<string, StoryAnimationAsset>;
    /**
     * The project registry's `saved` entries (bundle `ui.savedVariables`). Omitting them narrows the
     * walk to story-declared saved variables, so a registry-backed one would silently miss its
     * default and every `/set` on it would be dropped - pass them whenever the caller has a bundle.
     */
    savedVariables?: SavedVariableRuntimeTable;
}): StoryStageSnapshot {
    const scene = input.document.scenes[input.sceneId];
    if (!scene) {
        throw new Error(`Scene not found: ${input.sceneId}`);
    }
    const animations = input.animations instanceof Map
        ? input.animations
        : new Map(Object.entries(input.animations ?? {}));
    const walker = new SnapshotWalker(
        scene,
        input.targetBlockId,
        animations,
        savedVariableDefsFromView(collectSavedVariableView(input.document, input.savedVariables)),
    );
    return walker.run();
}

type VariableStore = {
    /** storageKey → value; seeded with defaults, updated by setVariable. */
    scene: Map<string, StoryLiteralValue | null | undefined>;
    saved: Map<string, StoryLiteralValue | null | undefined>;
};

class SnapshotWalker {
    private readonly pathBlockIds = new Set<string>();
    /** Declaration tables (variableId → def), scanned once per walk from the v6 declaration rows. */
    private readonly sceneDefs: Record<string, StorySceneVariableDefinition>;
    private readonly displayables = new Map<string, StageSnapshotDisplayable>();
    private readonly order: string[] = [];
    private readonly diagnostics: StageSnapshotDiagnostic[] = [];
    private readonly variables: VariableStore = { scene: new Map(), saved: new Map() };
    private readonly assignedScene: Record<string, StoryLiteralValue> = {};
    private readonly assignedSaved: Record<string, StoryLiteralValue> = {};
    private background: { assetId?: string; color?: string } | null = null;
    private backgroundProps: Record<string, unknown> = {};
    private backgroundEffects: StageSnapshotEffects = {};
    private builtinLayerProps = { backgroundLayer: {} as Record<string, unknown>, displayableLayer: {} as Record<string, unknown> };
    /** Story-level camera pose accumulated within this scene; null until a `/camera` op sets one. */
    private camera: StageSnapshotCamera | null = null;
    private nvl = false;
    private reachedTarget = false;

    constructor(
        private readonly scene: StoryScene,
        private readonly targetBlockId: string | null,
        private readonly animations: ReadonlyMap<string, StoryAnimationAsset>,
        /** Merged saved table (registry + story rows); see {@link collectSavedVariableView}. */
        private readonly savedDefs: Record<string, StorySavedVariableDefinition>,
    ) {
        let cursor = targetBlockId ? scene.blocks[targetBlockId] : undefined;
        while (cursor && !this.pathBlockIds.has(cursor.id)) {
            this.pathBlockIds.add(cursor.id);
            cursor = cursor.parentId ? scene.blocks[cursor.parentId] : undefined;
        }
        this.sceneDefs = sceneVariableDefs(scene);
        for (const saved of Object.values(this.savedDefs)) {
            this.variables.saved.set(saved.storageKey, saved.defaultValue ?? null);
        }
        for (const def of Object.values(this.sceneDefs)) {
            this.variables.scene.set(def.storageKey, def.defaultValue ?? null);
        }
    }

    run(): StoryStageSnapshot {
        if (this.targetBlockId === null) {
            // Scene start: nothing has executed yet.
        } else if (!this.pathBlockIds.has(this.targetBlockId)) {
            this.diagnostic(this.targetBlockId, translate("story.preview.diagnostics.targetNotFound"));
        } else {
            this.visitList(this.scene.rootBlockIds, false);
            if (!this.reachedTarget) {
                this.diagnostic(this.targetBlockId, translate("story.preview.diagnostics.targetUnreachable"));
            }
        }
        return {
            background: this.background,
            displayables: this.order.map(key => this.displayables.get(key) as StageSnapshotDisplayable),
            backgroundProps: this.backgroundProps,
            backgroundEffects: this.backgroundEffects,
            builtinLayerProps: this.builtinLayerProps,
            sceneVariables: this.assignedScene,
            savedVariables: this.assignedSaved,
            camera: this.camera,
            nvl: this.nvl,
            diagnostics: this.diagnostics,
        };
    }

    private visitList(blockIds: readonly string[], insideNvl: boolean): void {
        for (const blockId of blockIds) {
            if (this.reachedTarget) {
                return;
            }
            this.visitBlock(blockId, insideNvl);
        }
    }

    private visitBlock(blockId: string, insideNvl: boolean): void {
        const block = this.scene.blocks[blockId];
        if (!block) {
            return;
        }
        if (block.id === this.targetBlockId) {
            this.reachedTarget = true;
            this.nvl = insideNvl;
            return;
        }

        if (block.kind === "nodeAction") {
            if (block.payload.action === "choice") {
                this.visitChoice(block, insideNvl);
                return;
            }
            if (block.payload.action === "choiceOption") {
                this.visitList(block.childrenIds, insideNvl);
                return;
            }
            // narration / dialogue have no stage-state effect before the target.
            this.visitList(block.childrenIds, insideNvl);
            return;
        }

        if (block.kind === "action") {
            if (block.payload.action === "nvl") {
                this.visitList(block.childrenIds, true);
                return;
            }
            this.applyAction(block, block.payload);
            this.visitList(block.childrenIds, insideNvl);
            return;
        }

        if (block.kind === "control") {
            if (block.payload.control === "condition") {
                this.visitCondition(block, insideNvl);
                return;
            }
            if (block.payload.control === "conditionBranch") {
                this.visitList(block.childrenIds, insideNvl);
                return;
            }
            if (block.payload.control === "repeat" && (block.payload.until !== undefined || (block.payload.times ?? 1) !== 1)) {
                // A conditional loop says the same thing more strongly: how many times it would have
                // run is not knowable without running it, so the snapshot walks the body exactly once.
                this.diagnostic(block.id, translate("story.preview.diagnostics.repeatedGroupOnce"));
            }
            this.visitList(block.childrenIds, insideNvl);
            return;
        }

        if (block.kind === "jump") {
            this.diagnostic(block.id, translate("story.preview.diagnostics.sceneJumpIgnored"));
            return;
        }

        // note / declaration: no stage effect (declarations are authoring metadata; their defaults
        // already seeded the variable store above).
    }

    private visitChoice(block: Extract<StoryBlock, { kind: "nodeAction" }>, insideNvl: boolean): void {
        if (this.pathBlockIds.has(block.id)) {
            const option = block.childrenIds
                .map(childId => this.scene.blocks[childId])
                .find(child => child && this.pathBlockIds.has(child.id));
            if (option) {
                this.visitList(option.childrenIds, insideNvl);
                return;
            }
        }
        // A choice before the target: playback would take exactly one branch, but which one is
        // unknowable statically - assume none and continue after the menu.
        this.diagnostic(block.id, translate("story.preview.diagnostics.choiceNotTaken"));
    }

    private visitCondition(block: Extract<StoryBlock, { kind: "control" }>, insideNvl: boolean): void {
        const branches = block.childrenIds
            .map(childId => this.scene.blocks[childId])
            .filter((child): child is Extract<StoryBlock, { kind: "control" }> =>
                child?.kind === "control" && child.payload.control === "conditionBranch");

        if (this.pathBlockIds.has(block.id)) {
            const branch = branches.find(candidate => this.pathBlockIds.has(candidate.id));
            if (branch) {
                this.visitList(branch.childrenIds, insideNvl);
                return;
            }
        }
        for (const branch of branches) {
            if (branch.payload.control !== "conditionBranch") {
                continue;
            }
            if (branch.payload.branch === "else" || this.evaluateCondition(branch.payload.condition, branch.id)) {
                this.visitList(branch.childrenIds, insideNvl);
                return;
            }
        }
    }

    private evaluateCondition(condition: StoryConditionRef | undefined, blockId: string): boolean {
        if (!condition) {
            return false;
        }
        if (condition.kind === "expression") {
            if (!isStoryExpressionEvaluable(condition.expression.ast)) {
                this.diagnostic(blockId, translate("story.preview.diagnostics.conditionUnresolved", { expression: condition.expression.source }));
                return false;
            }
            // Unlike the blueprint branch below, this one really evaluates: the preview owns a variable
            // store, and the expression evaluator is the same pure function the compiler emits - so the
            // branch the author sees previewed is the branch the game will take from the same state.
            return isTruthy(evaluateStoryExpression(condition.expression.ast, this.expressionEnv(blockId)));
        }
        if (condition.kind === "blueprint") {
            // The preview follows the Studio-computed path when available; a blueprint condition that
            // is not on that path falls back to false rather than running the graph synchronously here.
            this.diagnostic(blockId, translate("story.preview.diagnostics.blueprintConditionFalse"));
            return false;
        }
        const target = condition.target;
        let current: StoryLiteralValue | null | undefined;
        if (target.scope === "persistent") {
            this.diagnostic(blockId, translate("story.preview.diagnostics.persistentConditionDefaults"));
            current = undefined;
        } else if (target.scope === "scene") {
            const def = this.sceneDefs[target.variableId];
            if (!def) {
                return false;
            }
            current = this.variables.scene.get(def.storageKey);
        } else {
            const def = this.savedDefs[target.variableId];
            if (!def) {
                return false;
            }
            current = this.variables.saved.get(def.storageKey);
        }
        switch (condition.operator) {
            case "isTrue":
                return current === true;
            case "isFalse":
                return current === false;
            case "equals":
                return current === condition.value;
            case "notEquals":
                return current !== condition.value;
            case "exists":
                return current !== null && current !== undefined;
            default:
                return false;
        }
    }

    private applyAction(block: StoryBlock, payload: StoryActionPayload): void {
        switch (payload.action) {
            case "setBackground": {
                if (payload.assetId) {
                    this.background = { assetId: payload.assetId };
                } else if (payload.color) {
                    this.background = { color: payload.color };
                }
                return;
            }
            case "character":
                this.applyCharacter(block, payload);
                return;
            case "image":
                this.applyImage(block, payload);
                return;
            case "displayable":
                this.applyDisplayable(block, payload);
                return;
            case "text":
                this.applyText(block, payload);
                return;
            case "layer":
                this.applyLayer(block, payload);
                return;
            case "camera":
                this.applyCamera(block, payload);
                return;
            case "setVariable":
                this.applySetVariable(block, payload);
                return;
            case "video":
                this.diagnostic(block.id, translate("story.preview.diagnostics.videoSkipped"));
                return;
            case "vfx":
                this.diagnostic(block.id, translate("story.preview.diagnostics.ambienceSkipped"));
                return;
            case "blueprint":
                this.diagnostic(block.id, translate("story.preview.diagnostics.storyActionSkipped"));
                return;
            // audio / wait / screenEffect / nvl: no settled visual state.
            default:
                return;
        }
    }

    private applyCharacter(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "character" }>): void {
        if (payload.operation === "setName") {
            // `/rename` retitles the speaker LABEL and touches no portrait, so it settles no stage
            // state at all - it must not even `ensure` a record, or renaming a character who was never
            // shown would conjure a blank one. Falling through to the enter/expression arm below would
            // be worse still: that arm rebuilds `source` from a payload `setName` never carries, so an
            // earlier `/face` would silently revert to the default look in a row-precise launch.
            return;
        }
        if (payload.operation === "setMotion" || payload.operation === "setSkin" || payload.operation === "setParams") {
            // The inside of a puppet's box, which no image record models: the snapshot tracks where a
            // thing sits and whether it is visible, and a motion changes neither. Falling through
            // would `ensure` an image record for a character that has no sprite at all.
            return;
        }
        const objectName = getCharacterStageObjectName(payload);
        const record = this.ensure("image", objectName, block.id);
        record.autoFit = true;
        if (payload.operation === "exit") {
            record.visible = false;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform ?? { preset: "fadeOut", durationMs: 250 }, "hide", block.id));
            return;
        }
        if (payload.operation === "move") {
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "none", block.id));
            return;
        }
        // enter / expression update the source. A layered character's expression row is incremental
        // — it names only the axes it changes — so the snapshot has to accumulate them the way the
        // engine does, or pre-posing at a later block would drop every earlier axis change.
        const previous = record.source?.type === "character" ? record.source : null;
        const carried = payload.operation === "expression" ? previous?.tags : undefined;
        record.source = payload.assetId
            ? { type: "asset", assetId: payload.assetId }
            : {
                type: "character",
                characterId: payload.characterId,
                pose: payload.pose ?? (payload.operation === "expression" ? previous?.pose : undefined),
                tags: carried || payload.tags ? { ...carried, ...payload.tags } : undefined,
            };
        if (payload.operation === "enter") {
            record.visible = true;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "show", block.id));
        }
    }

    private applyImage(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "image" }>): void {
        const record = this.ensure("image", payload.objectName, block.id);
        if (payload.autoFit !== undefined) {
            record.autoFit = payload.autoFit;
        }
        if (payload.layer) {
            record.layer = payload.layer;
        }
        if ((payload.operation === "create" || payload.operation === "setSource")) {
            if (payload.assetId) {
                record.source = { type: "asset", assetId: payload.assetId };
            } else if (payload.color) {
                record.source = { type: "color", color: payload.color };
            }
        }
        if (payload.operation === "show" || payload.operation === "create") {
            record.visible = true;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "show", block.id));
        } else if (payload.operation === "hide") {
            record.visible = false;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "hide", block.id));
        }
    }

    private applyText(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "text" }>): void {
        const record = this.ensure("text", payload.objectName, block.id);
        if ((payload.operation === "create" || payload.operation === "setText") && payload.text !== undefined) {
            record.text = payload.text;
        }
        if (payload.operation === "setFontSize" || (payload.operation === "create" && payload.fontSize !== undefined)) {
            record.fontSize = payload.fontSize ?? 16;
        }
        if (payload.operation === "setFontColor" || (payload.operation === "create" && payload.fontColor)) {
            record.fontColor = payload.fontColor ?? "#ffffff";
        }
        if (payload.operation === "create" && payload.fontSize === undefined && record.fontSize === undefined) {
            record.fontSize = 32;
        }
        if (payload.layer) {
            record.layer = payload.layer;
        }
        if (payload.operation === "show" || payload.operation === "create") {
            record.visible = true;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "show", block.id));
        } else if (payload.operation === "hide") {
            record.visible = false;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "hide", block.id));
        }
    }

    private applyLayer(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "layer" }>): void {
        if (payload.operation === "create") {
            const record = this.ensure("layer", payload.objectName, block.id);
            if (payload.zIndex !== undefined) {
                record.zIndex = payload.zIndex;
            }
            return;
        }
        // Non-create layer ops address an existing target (built-in fallback: displayable layer).
        const targetProps = this.resolveLayerTargetProps(payload);
        if (payload.operation === "setZIndex") {
            if (targetProps.record) {
                targetProps.record.zIndex = payload.zIndex ?? 0;
            }
            return;
        }
        if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "transform") {
            const visibility: VisibilityTransformMode = payload.operation === "transform" ? "none" : payload.operation;
            const props = this.finalProps(payload.transform, visibility, block.id);
            if (targetProps.record) {
                if (payload.operation !== "transform") {
                    targetProps.record.visible = payload.operation === "show";
                }
                targetProps.record.props = mergeTransformProps(targetProps.record.props, props);
            } else if (targetProps.builtin) {
                this.builtinLayerProps[targetProps.builtin] = mergeTransformProps(this.builtinLayerProps[targetProps.builtin], props);
            }
        }
    }

    /**
     * Accumulate the stage camera's settled pose. Each op writes its own channel and the latest
     * value wins (matching the runtime, where `/camera` transforms are absolute, not relative);
     * `reset` returns the camera to neutral, which for a pre-pose means "nothing to apply".
     *
     * Values are clamped with the same idiom the compiler's `compileCameraAction` uses, because the
     * pose is pre-posed directly onto the camera and never passes through that compile path.
     */
    private applyCamera(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "camera" }>): void {
        if (payload.operation === "reset") {
            this.camera = null;
            return;
        }
        const camera = this.camera ?? (this.camera = { props: {}, effects: {} });
        switch (payload.operation) {
            case "motion":
                // A camera motion settles like any other transform, and this class already holds the
                // animation assets - so the shot a `/camera motion` row leaves behind is reconstructed
                // rather than dropped, and a row launch placed after it opens on the same frame the
                // real playthrough would show.
                camera.props = mergeTransformProps(camera.props, this.finalProps(payload.motion, "none", block.id));
                return;
            case "pan":
                camera.props.position = getPresetPosition("custom", {
                    xalign: payload.position?.xalign ?? 0.5,
                    yalign: payload.position?.yalign ?? 0.5,
                    ...(payload.position?.xoffset !== undefined ? { xoffset: payload.position.xoffset } : {}),
                    ...(payload.position?.yoffset !== undefined ? { yoffset: payload.position.yoffset } : {}),
                });
                return;
            case "zoom":
                camera.props.zoom = Math.max(MIN_CAMERA_ZOOM, finiteOr(payload.zoom, 1));
                return;
            case "rotate":
                camera.props.rotation = finiteOr(payload.rotation, 0);
                return;
            case "darken":
                camera.effects.darkness = Math.min(1, Math.max(0, finiteOr(payload.darkness, 0)));
                return;
            default:
                return;
        }
    }

    private resolveLayerTargetProps(payload: Extract<StoryActionPayload, { action: "layer" }>): {
        record?: StageSnapshotDisplayable;
        builtin?: "backgroundLayer" | "displayableLayer";
    } {
        const target = payload.target;
        if (target?.kind === "default") {
            return { builtin: target.layer === "background" ? "backgroundLayer" : "displayableLayer" };
        }
        if (target?.kind === "custom") {
            const source = target.sourceBlockId ? this.scene.blocks[target.sourceBlockId] : undefined;
            const name = source?.kind === "action" && source.payload.action === "layer"
                ? source.payload.objectName
                : target.name;
            const record = this.displayables.get(this.key("layer", name ?? ""));
            return record ? { record } : { builtin: "displayableLayer" };
        }
        const record = this.displayables.get(this.key("layer", payload.objectName));
        return record ? { record } : { builtin: "displayableLayer" };
    }

    private applyDisplayable(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "displayable" }>): void {
        const bucket = this.resolveDisplayableBucket(payload, block.id);
        if (!bucket) {
            return;
        }
        const operation = payload.operation;
        if (operation === "show" || operation === "hide" || operation === "transform") {
            const visibility: VisibilityTransformMode = operation === "transform" ? "none" : operation;
            const props = this.finalProps(payload.transform, visibility, block.id);
            if (bucket.record) {
                if (operation !== "transform") {
                    bucket.record.visible = operation === "show";
                }
                bucket.record.props = mergeTransformProps(bucket.record.props, props);
            } else if (bucket.background) {
                this.backgroundProps = mergeTransformProps(this.backgroundProps, props);
            } else if (bucket.builtinLayer) {
                this.builtinLayerProps[bucket.builtinLayer] = mergeTransformProps(this.builtinLayerProps[bucket.builtinLayer], props);
            }
            return;
        }
        const effects = bucket.record?.effects ?? (bucket.background ? this.backgroundEffects : null);
        if (!effects) {
            return;
        }
        switch (operation) {
            case "mask":
                if (payload.maskAssetId) {
                    effects.mask = { assetId: payload.maskAssetId };
                }
                return;
            case "clearMask":
                effects.mask = "clear";
                return;
            case "clip":
                if (payload.clipPath) {
                    effects.clip = { clipPath: payload.clipPath };
                }
                return;
            case "clearClip":
                effects.clip = "clear";
                return;
            case "filter":
                if (payload.filter) {
                    effects.filter = { filter: payload.filter };
                }
                return;
            case "clearFilter":
                effects.filter = "clear";
                return;
            case "darken":
                effects.darkness = Math.min(1, Math.max(0, payload.darkness ?? 0));
                return;
            case "circleReveal":
                // Ends fully revealed.
                effects.clip = "clear";
                return;
            case "circleClose":
                effects.clip = { clipPath: "circle(0.0% at 50% 50%)" };
                return;
            case "wipe":
                // A completed wipe leaves the element fully revealed.
                effects.clip = "clear";
                return;
            default:
                return;
        }
    }

    private resolveDisplayableBucket(payload: Extract<StoryActionPayload, { action: "displayable" }>, blockId: string): {
        record?: StageSnapshotDisplayable;
        background?: boolean;
        builtinLayer?: "backgroundLayer" | "displayableLayer";
    } | null {
        const target = payload.target;
        if (target.builtin === "background") {
            return { background: true };
        }
        if (target.builtin === "backgroundLayer") {
            return { builtinLayer: "backgroundLayer" };
        }
        if (target.builtin === "displayableLayer") {
            return { builtinLayer: "displayableLayer" };
        }
        const resolved = resolveDisplayableTargetRef(this.scene, target);
        const kind = resolved.kind === "character" || !resolved.kind ? "image" : resolved.kind;
        const record = this.displayables.get(this.key(kind === "text" ? "text" : kind === "layer" ? "layer" : "image", resolved.name));
        if (!record) {
            this.diagnostic(blockId, translate("story.preview.diagnostics.displayableNotFound", {
                target: resolved.label || resolved.name || translate("story.preview.diagnostics.displayableUnnamed"),
            }));
            return null;
        }
        return { record };
    }

    private applySetVariable(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "setVariable" }>): void {
        const target = payload.target;
        const value = this.resolveAssignedValue(block, payload);
        if (value === undefined) {
            return;
        }
        if (target.scope === "scene") {
            const def = this.sceneDefs[target.variableId];
            if (!def) {
                return;
            }
            this.variables.scene.set(def.storageKey, value);
            this.assignedScene[def.storageKey] = value;
            return;
        }
        if (target.scope === "saved") {
            const def = this.savedDefs[target.variableId];
            if (!def) {
                return;
            }
            this.variables.saved.set(def.storageKey, value);
            this.assignedSaved[def.storageKey] = value;
            return;
        }
        this.diagnostic(block.id, translate("story.preview.diagnostics.persistentAssignmentSkipped"));
    }

    /**
     * The value a `setVariable` row settles on: its literal, or its expression evaluated against the
     * variables this walk has accumulated so far. `undefined` means "do not assign".
     *
     * The preview runs the same evaluator as the compiler, so `/set gold gold + 1` moves the counter
     * here exactly as it will in the game. What differs is the starting state - this walk seeds from
     * declared defaults and has no host persistence - which is why a persistent read is reported
     * rather than silently folded in as `null`.
     */
    private resolveAssignedValue(
        block: StoryBlock,
        payload: Extract<StoryActionPayload, { action: "setVariable" }>,
    ): StoryLiteralValue | undefined {
        if (!payload.expression) {
            return payload.value;
        }
        if (!isStoryExpressionEvaluable(payload.expression.ast)) {
            this.diagnostic(block.id, translate("story.preview.diagnostics.assignmentUnresolved", { expression: payload.expression.source }));
            return undefined;
        }
        return evaluateStoryExpression(payload.expression.ast, this.expressionEnv(block.id));
    }

    /**
     * What an expression may reach in the PREVIEW, and what it may not.
     *
     * The variable half really evaluates (see `evaluateCondition`). The other two cannot, and the
     * answer is the one `storyStageSnapshot` already gives a blueprint condition: do not run it,
     * return the type's zero, and say so in a diagnostic that names the thing.
     *
     *  - **visited / picked.** The record is written by a *playthrough*; this walk is a static read of
     *    one scene's blocks with no run behind it. Nothing here knows whether the player has been to
     *    a scene, and a preview that answered "yes" or "no" as if it did would show the author a route
     *    lock opening or closing for a reason that does not exist.
     *  - **invoke.** Running the graph would need a live `ScriptCtx` (a storable, a host adapter) that
     *    this walk has none of; the compiler builds one from the compiled story, which is precisely
     *    what a preview is not.
     *
     * The diagnostic is not decoration. Returning the zero silently is indistinguishable from the
     * expression having genuinely evaluated to it, which is how "the preview is lying to me" becomes
     * "the feature is broken" - so the name goes in the message and the test asserts it is produced.
     */
    private expressionEnv(blockId: string): StoryExpressionEnv {
        return {
            read: ref => this.readVariable(ref, blockId),
            visited: (ref, name) => {
                this.diagnostic(
                    blockId,
                    ref.kind === "scene"
                        ? translate("story.preview.diagnostics.sceneVisitUntracked", { name })
                        : translate("story.preview.diagnostics.choicePickUntracked", { name }),
                );
                return false;
            },
            invoke: (_blueprintId, name) => {
                this.diagnostic(blockId, translate("story.preview.diagnostics.blueprintCallEmpty", { name }));
                return undefined;
            },
        };
    }

    /** Read a variable out of the preview's own store. Persistent variables have no preview backing. */
    private readVariable(ref: StoryVariableRef, blockId: string): StoryLiteralValue | undefined {
        if (ref.scope === "persistent") {
            this.diagnostic(blockId, translate("story.preview.diagnostics.persistentReadEmpty"));
            return undefined;
        }
        if (ref.scope === "scene") {
            const def = this.sceneDefs[ref.variableId];
            return def ? this.variables.scene.get(def.storageKey) : undefined;
        }
        const def = this.savedDefs[ref.variableId];
        return def ? this.variables.saved.get(def.storageKey) : undefined;
    }

    private finalProps(transform: StoryTransformRef | undefined, visibility: VisibilityTransformMode, blockId: string): Record<string, unknown> {
        return storyTransformRefFinalProps(transform, visibility, this.animations, message => this.diagnostic(blockId, message));
    }

    private ensure(kind: "image" | "text" | "layer", objectName: string | undefined, sourceBlockId: string): StageSnapshotDisplayable {
        const key = this.key(kind, objectName ?? "");
        const existing = this.displayables.get(key);
        if (existing) {
            return existing;
        }
        const record: StageSnapshotDisplayable = {
            kind,
            objectName: normalizeObjectName(objectName),
            sourceBlockId,
            // NLR defaults: images/texts mount hidden (opacity 0); layers mount visible (opacity 1).
            visible: kind === "layer",
            props: {},
            effects: {},
        };
        this.displayables.set(key, record);
        this.order.push(key);
        return record;
    }

    private key(kind: "image" | "text" | "layer", objectName: string): string {
        return `${kind}:${normalizeObjectName(objectName)}`;
    }

    private diagnostic(blockId: string | undefined, message: string): void {
        this.diagnostics.push({ level: "warning", blockId, message });
    }
}
