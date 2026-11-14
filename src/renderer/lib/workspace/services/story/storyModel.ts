/**
 * The story model's pure helpers now live in `@shared/story/storyModel`, where the Team server's
 * project authority can apply operations with the same code the editor does. Re-exported here so
 * the editor's many importers did not have to move.
 */
export * from "@shared/story/storyModel";
