import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { PSD_UNREADABLE } from "@shared/types/psdImport";
import { SurfacePuppetUnavailableError } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import { describePsdFailure } from "./psdImportFailure";
import { describePuppetPreviewFailure } from "./puppetPreviewFailure";

/**
 * The lines the character editor shows when a PSD cannot be read or a puppet cannot be drawn.
 *
 * Both used to print what was thrown: the PSD parser's English ("Invalid signature") or Node's with
 * the file's full path, and a puppet runtime's message, which can be a module load error naming the
 * bundle's `app://` address.
 */

const LEAKS = /app:\/\/|[A-Z]:[\\/]|Invalid|signature|EACCES|\{\w+\}/;

describe("a PSD the wizard could not read", () => {
    it("says why, for the two answers an author can act on", () => {
        const t = createTranslator("en").t;
        expect(describePsdFailure(t("characters.editor.psd.readFailed"), PSD_UNREADABLE, t))
            .toBe("This PSD could not be read. Its file is damaged or is not in a format Studio can open.");
        expect(describePsdFailure(t("characters.editor.psd.readFailed"), FsRejectErrorCode.PERMISSION_DENIED, t))
            .toBe("This PSD could not be read. Studio is not allowed to read its file.");
    });

    it("says nothing it cannot know: not that a picked file is missing from the project", () => {
        const t = createTranslator("en").t;
        expect(describePsdFailure(t("characters.editor.psd.readFailed"), FsRejectErrorCode.NOT_FOUND, t))
            .toBe("This PSD could not be read.");
        expect(describePsdFailure(t("characters.editor.psd.readFailed"), undefined, t))
            .toBe("This PSD could not be read.");
    });

    it.each(SUPPORTED_LOCALES.filter(locale => locale !== "en"))("says it in %s, with no English", locale => {
        const t = createTranslator(locale).t;
        for (const code of [PSD_UNREADABLE, FsRejectErrorCode.PERMISSION_DENIED, undefined]) {
            const line = describePsdFailure(t("characters.editor.psd.readFailed"), code, t);
            expect(line).not.toMatch(LEAKS);
            expect(line.replace(/PSD|Studio/g, "")).not.toMatch(/[A-Za-z]{2,}/);
        }
    });
});

describe("a puppet the preview could not draw", () => {
    it("words a refusal the way the puppet widget does", () => {
        const t = createTranslator("en").t;
        expect(describePuppetPreviewFailure(new SurfacePuppetUnavailableError("backend-missing", "The runtime \"spine\" is not installed"), "spine", t))
            .toBe(t("widgets.puppet.placeholderBackendMissing", { backend: "spine" }));
        expect(describePuppetPreviewFailure(new SurfacePuppetUnavailableError("no-model", "Model asset 5322b0e3-f48d-4b77-bfcd-7406613191ce is not in this project"), "spine", t))
            .toBe(t("widgets.puppet.placeholderNoModel"));
        expect(describePuppetPreviewFailure(new SurfacePuppetUnavailableError("distrusted"), "spine", t))
            .toBe(t("widgets.puppet.placeholderDistrusted"));
    });

    it("has no second line for a runtime that failed once it was running", () => {
        const t = createTranslator("en").t;
        const thrown = new TypeError("Failed to fetch dynamically imported module: app://fs/3f9c1a/runtimes/puppet/spine/index.js");
        expect(describePuppetPreviewFailure(thrown, "spine", t)).toBeNull();
    });

    it.each(SUPPORTED_LOCALES)("never carries an id or an address (%s)", locale => {
        const t = createTranslator(locale).t;
        for (const reason of ["no-model", "no-backend", "backend-missing", "distrusted"] as const) {
            const line = describePuppetPreviewFailure(new SurfacePuppetUnavailableError(reason, "Model asset 5322b0e3 is not here"), "spine", t);
            expect(line).not.toBeNull();
            expect(line!).not.toMatch(LEAKS);
            expect(line!).not.toMatch(/5322b0e3/);
        }
    });
});
