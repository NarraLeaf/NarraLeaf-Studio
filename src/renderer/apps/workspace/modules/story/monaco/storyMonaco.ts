import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

export const STORY_LANGUAGE_ID = "narraleaf-story";
export const STORY_THEME_ID = "narraleaf-story-dark";

let configured = false;

loader.config({ monaco });

export function configureStoryMonaco(instance: typeof monaco): void {
    if (configured) {
        return;
    }
    configured = true;

    const registeredLanguages = instance.languages.getLanguages();
    if (!registeredLanguages.some(language => language.id === STORY_LANGUAGE_ID)) {
        instance.languages.register({ id: STORY_LANGUAGE_ID });
    }

    instance.languages.setMonarchTokensProvider(STORY_LANGUAGE_ID, {
        tokenizer: {
            root: [
                [/^\s*\/\/.*$/, "comment"],
                [/^\s*\/[a-zA-Z][\w-]*/, "keyword"],
                [/^\s*-\s*/, "type"],
                [/^[^:\n]+:/, "identifier"],
            ],
        },
    });

    instance.languages.registerCompletionItemProvider(STORY_LANGUAGE_ID, {
        triggerCharacters: ["/"],
        provideCompletionItems(model, position) {
            const line = model.getLineContent(position.lineNumber);
            const textUntilPosition = line.slice(0, position.column - 1);
            if (!/^\s*\/[\w-]*$/.test(textUntilPosition)) {
                return { suggestions: [] };
            }
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: textUntilPosition.lastIndexOf("/") + 1,
                endColumn: position.column,
            };
            return {
                suggestions: [
                    {
                        label: "/narration",
                        kind: instance.languages.CompletionItemKind.Snippet,
                        insertText: "/narration ",
                        range,
                    },
                    {
                        label: "/dialogue",
                        kind: instance.languages.CompletionItemKind.Snippet,
                        insertText: "/dialogue ",
                        range,
                    },
                    {
                        label: "/note",
                        kind: instance.languages.CompletionItemKind.Snippet,
                        insertText: "/note ",
                        range,
                    },
                ],
            };
        },
    });

    instance.editor.defineTheme(STORY_THEME_ID, {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "comment", foreground: "7c8797" },
            { token: "keyword", foreground: "67e8f9" },
            { token: "identifier", foreground: "facc15" },
            { token: "type", foreground: "a78bfa" },
        ],
        colors: {
            "editor.background": "#0f1115",
            "editor.foreground": "#dbeafe",
            "editor.lineHighlightBackground": "#1e293b80",
            "editorLineNumber.foreground": "#64748b",
            "editorLineNumber.activeForeground": "#e2e8f0",
            "editorCursor.foreground": "#67e8f9",
            "editor.selectionBackground": "#2563eb55",
            "editor.inactiveSelectionBackground": "#33415588",
        },
    });
}

export type StoryMonaco = typeof monaco;
