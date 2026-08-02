/**
 * The character store's version constant and its migration, which now live in
 * `@shared/characters/characterStoreModel`.
 *
 * They moved with the model, and for the same reason: the `characters` document spec has to migrate
 * a store it read out of a revision, in the main process. Re-exported here because this is the path
 * the renderer's services and tests have always imported them from.
 */
export * from "@shared/characters/characterStoreModel";
