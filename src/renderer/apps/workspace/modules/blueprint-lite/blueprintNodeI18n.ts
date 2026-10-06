/**
 * The blueprint node words, at the path the workspace has always imported them from.
 *
 * The tables and resolvers live in `@/lib/ui-editor/blueprint-nodes/blueprintNodeI18n`, beside the
 * node definitions they translate: the blueprint thumbnail draws node titles too, and it is shared
 * code the game runtime's bundle may reach, which cannot import from the workspace app.
 */
export * from "@/lib/ui-editor/blueprint-nodes/blueprintNodeI18n";
