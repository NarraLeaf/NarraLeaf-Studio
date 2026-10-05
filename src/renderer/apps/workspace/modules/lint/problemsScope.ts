import type { LintLocation, LintReportEntry } from "@/lib/lint";

/**
 * Which findings the Problems panel lists: the whole project's, or only those about what is open.
 *
 * The sweep always covers the whole project - a finding is often about the seam between two things
 * (a jump into a scene, a page a blueprint opens), and a sweep of the open tabs alone would report a
 * deleted scene's callers as fine. The scope is a view over that one report, the way VS Code's
 * Problems panel can show the active file only: it decides what is listed, never what is checked.
 *
 * Nothing here knows React or the workspace; the panel hands in the open tabs and gets back a
 * predicate, so the mapping from "a tab" to "the things it shows" is testable on its own.
 */

export type ProblemsScope = "project" | "openEditors" | "activeEditor";

export const PROBLEMS_SCOPES: readonly ProblemsScope[] = ["project", "openEditors", "activeEditor"] as const;

/** One thing an editor tab shows, in the terms a finding's location names. */
export type EditorSubject =
    | { kind: "storyScene"; storyId: string; sceneId: string }
    /** A whole story: its flow map shows every scene in it. */
    | { kind: "story"; storyId: string }
    | { kind: "surface"; surfaceId: string }
    | { kind: "component"; componentId: string }
    | { kind: "blueprint"; blueprintId: string }
    | { kind: "character"; characterId: string }
    | { kind: "asset"; assetId: string };

/** The fields of a tab this reads; `EditorTab` satisfies it. */
export type ScopeTab = { id: string; payload?: unknown };

const ASSET_TAB_PATTERN = /^narraleaf-studio:assets:(?:[a-z]+-preview|text-editor)-(.+)$/;
const CHARACTER_TAB_PREFIX = "narraleaf-studio:character-editor-";
const STORY_SCENE_TAB_PREFIX = "story:scene:";
const STORY_FLOW_TAB_PREFIX = "story:flow:";
const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const COMPONENT_TAB_PREFIX = "ui-editor:component:";
const BLUEPRINT_TAB_PREFIX = "blueprint-entry:";

function stringField(payload: unknown, field: string): string | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const value = (payload as Record<string, unknown>)[field];
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What one editor tab shows, or null for a tab that is not about any one thing (the dashboard, a
 * report, the help browser).
 *
 * The payload first, where the tab carries one - it is what the editor itself reads - and the id
 * for the tabs whose identity is all there is to read. Unknown tabs answer null, so a tab kind
 * added later simply contributes nothing to "open editors" rather than everything.
 */
export function editorSubjectOf(tab: ScopeTab): EditorSubject | null {
    const { id, payload } = tab;
    if (id.startsWith(STORY_SCENE_TAB_PREFIX)) {
        const storyId = stringField(payload, "storyId");
        const sceneId = stringField(payload, "sceneId");
        if (storyId && sceneId) {
            return { kind: "storyScene", storyId, sceneId };
        }
        const [rawStory, rawScene] = id.slice(STORY_SCENE_TAB_PREFIX.length).split(":");
        return rawStory && rawScene ? { kind: "storyScene", storyId: rawStory, sceneId: rawScene } : null;
    }
    if (id.startsWith(STORY_FLOW_TAB_PREFIX)) {
        const storyId = stringField(payload, "storyId") ?? id.slice(STORY_FLOW_TAB_PREFIX.length);
        return storyId ? { kind: "story", storyId } : null;
    }
    if (id.startsWith(SURFACE_TAB_PREFIX)) {
        const surfaceId = stringField(payload, "surfaceId") ?? id.slice(SURFACE_TAB_PREFIX.length);
        return surfaceId ? { kind: "surface", surfaceId } : null;
    }
    if (id.startsWith(COMPONENT_TAB_PREFIX)) {
        const componentId = stringField(payload, "componentId") ?? id.slice(COMPONENT_TAB_PREFIX.length);
        return componentId ? { kind: "component", componentId } : null;
    }
    if (id.startsWith(BLUEPRINT_TAB_PREFIX)) {
        const blueprintId = stringField(payload, "blueprintId");
        return blueprintId ? { kind: "blueprint", blueprintId } : null;
    }
    if (id.startsWith(CHARACTER_TAB_PREFIX)) {
        const characterId = id.slice(CHARACTER_TAB_PREFIX.length);
        return characterId ? { kind: "character", characterId } : null;
    }
    const asset = ASSET_TAB_PATTERN.exec(id);
    if (asset) {
        return { kind: "asset", assetId: asset[1] };
    }
    return null;
}

/** Whether a finding at `location` is about `subject`. */
export function locationIsAbout(location: LintLocation, subject: EditorSubject): boolean {
    switch (subject.kind) {
        case "storyScene":
            return (
                location.kind === "story"
                && location.storyId === subject.storyId
                && location.sceneId === subject.sceneId
            );
        case "story":
            return location.kind === "story" && location.storyId === subject.storyId;
        case "surface":
            return location.kind === "surface" && location.surfaceId === subject.surfaceId;
        case "component":
            return location.kind === "component" && location.componentId === subject.componentId;
        case "blueprint":
            return location.kind === "blueprint" && location.blueprintId === subject.blueprintId;
        case "character":
            return location.kind === "character" && location.characterId === subject.characterId;
        case "asset":
            return location.kind === "asset" && location.assetId === subject.assetId;
    }
}

/**
 * Keep the findings the scope lists.
 *
 * `openTabs` is every tab in every pane; `activeTab` is the one editor focus is on. A scope that
 * names editors with none open lists nothing, which the panel says in words rather than by showing
 * the whole project instead.
 */
export function filterEntriesByScope(
    entries: readonly LintReportEntry[],
    scope: ProblemsScope,
    openTabs: readonly ScopeTab[],
    activeTab: ScopeTab | null,
): LintReportEntry[] {
    if (scope === "project") {
        return [...entries];
    }
    const tabs = scope === "activeEditor" ? (activeTab ? [activeTab] : []) : openTabs;
    const subjects = tabs.map(editorSubjectOf).filter((subject): subject is EditorSubject => subject !== null);
    if (subjects.length === 0) {
        return [];
    }
    return entries.filter(entry => subjects.some(subject => locationIsAbout(entry.location, subject)));
}
