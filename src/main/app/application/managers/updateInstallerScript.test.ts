import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The installer script embeds the app package a second time, for --nl-prepare, and the installer
 * stays its old size only because makensis writes a block it has already written once. It can only
 * do that when the bytes match: the template stores the package with compression off, so every copy
 * this script adds has to be stored the same way. Compressed under the default setting instead, the
 * copy was a second 330 MB block - 1.4.3's installer was twice 1.4.2's, and an update from 1.4.2
 * downloaded 280 MB where 15 would have done. Nothing fails when that happens, so this does.
 */

const SCRIPT = path.resolve(__dirname, "../../../../../project/installer/installer.nsh");

describe("the installer script's copies of the app package", () => {
    const lines = fs.readFileSync(SCRIPT, "utf-8").split(/\r?\n/);
    const packageFiles = lines
        .map((line, index) => ({ line: line.trim(), index }))
        .filter(({ line }) => /^File\b.*\$\{APP_(64|ARM64|32)\}/.test(line));

    it("are there to check", () => {
        expect(packageFiles.length).toBeGreaterThan(0);
    });

    it("are each stored with compression off, as the template stores its own", () => {
        for (const { index } of packageFiles) {
            const setting = lines.slice(0, index).reverse().map(line => line.trim())
                .find(line => /^SetCompress\b/.test(line));
            expect(setting, `line ${index + 1}: ${lines[index].trim()}`).toBe("SetCompress off");
        }
    });
});
