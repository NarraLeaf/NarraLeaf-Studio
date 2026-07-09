import type { ConsoleChannelDefinition } from "@/lib/workspace/services/core/ConsoleService";

/**
 * The console channel the story scene preview writes to. Registered while a story scene editor is
 * open (see StorySceneEditorTab) and fed compile diagnostics + runtime warnings by the preview
 * controller, so preview problems surface in the shared bottom console instead of only inline.
 */
export const STORY_CONSOLE_CHANNEL_ID = "story";

export const STORY_CONSOLE_CHANNEL: ConsoleChannelDefinition = {
    id: STORY_CONSOLE_CHANNEL_ID,
    label: "Story",
    description: "Story scene preview diagnostics and warnings",
};
