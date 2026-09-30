import { describe, expect, it } from "vitest";
import { hostLitterKind, isHostLitter } from "./hostLitter";

describe("host litter", () => {
    it("recognises what file managers and the operating system leave in folders", () => {
        for (const name of [
            ".DS_Store",
            "._body.png",
            "._.DS_Store",
            "__MACOSX",
            ".AppleDouble",
            ".Spotlight-V100",
            ".Trashes",
            ".fseventsd",
            ".TemporaryItems",
            "Icon\r",
            "Thumbs.db",
            "thumbs.db",
            "ehthumbs.db",
            "ehthumbs_vista.db",
            "desktop.ini",
            "Desktop.ini",
            ".directory",
        ]) {
            expect(hostLitterKind(name), JSON.stringify(name)).toBe("file-manager");
        }
    });

    it("recognises editors' swap, lock and backup files", () => {
        for (const name of [
            "~$script.docx",
            ".body.png.swp",
            ".Hiyori.model3.json.swo",
            ".index.js.swa",
            "body.png~",
            ".#index.js",
            "#index.js#",
        ]) {
            expect(hostLitterKind(name), name).toBe("editor");
        }
    });

    it("recognises a version control checkout and Studio's own half-written scratch files", () => {
        expect(hostLitterKind(".git")).toBe("version-control");
        expect(hostLitterKind(".svn")).toBe("version-control");
        expect(hostLitterKind(".hg")).toBe("version-control");
        expect(hostLitterKind("assets.metadata.image.json.nltmp")).toBe("studio");
    });

    /*
     * The other half of the contract, and the one that matters more: matching is by name at any
     * depth, so a false positive silently drops something an author shipped. Each of these is a
     * plausible file in a model export, a puppet backend or an Electron distribution.
     */
    it("leaves every plausible content name alone", () => {
        for (const name of [
            "Hiyori.model3.json",
            "texture_00.png",
            "body.png",
            "index.js",
            "Icon",
            "icon.png",
            "Icons",
            "desktop.ini.txt",
            "thumbs.db.bak",
            "DS_Store",
            "_underscore.png",
            "~tilde-first.png",
            "~",
            "#",
            "##",
            "#hash.png",
            ".gitignore",
            ".github",
            ".hidden-texture.png",
            "swap.swp",
            "notes.log",
            "node_modules",
            "dist",
            "cache",
            "LICENSE",
            "LICENSES.chromium.html",
            "version",
            "default_app.asar",
        ]) {
            expect(isHostLitter(name), JSON.stringify(name)).toBe(false);
        }
    });
});
