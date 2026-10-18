import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Ctrl+Z in an asset's preview tab takes back the project's last step.
 *
 * Replace File…, a conversion and a frame saved as a picture are recorded on the project's stack,
 * and the preview tab is where the author is looking when they want one back. The shell's undo
 * binding stands down in every editor tab, so a preview that mounts nothing of its own leaves the
 * key doing nothing at all - which is what the video, font and JSON previews did after the image
 * preview learned it.
 *
 * Read off the sources rather than rendered: each preview editor pulls in a workspace, a file
 * service and a media pipeline, and what this guards is only that every one of them, present and
 * future, either mounts `EditorProjectUndoKeybindings` or binds the key to a stack of its own (the
 * audio preview's markers).
 */
describe("asset preview tabs and Ctrl+Z", () => {
    const directory = __dirname;
    const editors = readdirSync(directory).filter(name => /PreviewEditor\.tsx$/.test(name));

    it("finds the preview editors", () => {
        expect(editors).toEqual(expect.arrayContaining([
            "AudioPreviewEditor.tsx",
            "FontPreviewEditor.tsx",
            "ImagePreviewEditor.tsx",
            "JsonPreviewEditor.tsx",
            "VideoPreviewEditor.tsx",
        ]));
    });

    for (const name of editors) {
        it(`${name} answers Ctrl+Z`, () => {
            const source = readFileSync(path.join(directory, name), "utf8");
            const mountsProjectUndo = /<EditorProjectUndoKeybindings\s+tabId=/.test(source);
            const bindsOwnUndo = /key:\s*"mod\+z"/.test(source);
            expect(mountsProjectUndo || bindsOwnUndo).toBe(true);
        });
    }
});
