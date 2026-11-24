# NarraLeaf Studio Licensing

Applies to NarraLeaf Studio 2.0.0 and later.

中文版本：LICENSING.zh-CN.md

This document explains the licensing questions involved in making, packaging and releasing games with NarraLeaf Studio. It describes the licenses of the components involved and does not replace them; where the two differ, the license texts prevail.

## In short

- Studio is free to use, and its source code is published under the Mozilla Public License 2.0 (MPL-2.0).
- Games you make with Studio belong to you. You may release them commercially for free and sell them on any third-party platform, with no license to apply for, no fee and no revenue share.
- The NarraLeaf and third-party components included in exported games may all be distributed with commercial games, and so may the asset protection component included when "Encrypt assets" is on.
- You are not required to add NarraLeaf credits, a splash screen or an engine logo to your game. You only need to keep the license files Studio places in the game when it exports it.
- Exceptions: Live2D and Spine support, third-party plugins and templates, and assets you import yourself need licenses of their own under their own terms (see section 5).

## 1. Your work

The scripts, characters, artwork, audio, interfaces and other project content you create with Studio belong to you or to their respective rights holders. NarraLeaf claims no rights in them.

## 2. NarraLeaf components in exported games

| Component | Included | License |
|---|---|---|
| The game runtime, and the built-in plugins the author enables (Gallery, Menu Bar, Quick Save, Text Effects) | Always | MPL-2.0 (from the NarraLeaf Studio repository) |
| The NarraLeaf React engine (`narraleaf-react`) | Always | MPL-2.0 |
| The mobile shell (`@narraleaf/studio-shell`) | Android / iOS exports | MPL-2.0 |
| The asset protection component | Desktop builds (Windows, macOS, Linux) when "Encrypt assets" is on | NarraLeaf proprietary license (see below) |

**What MPL-2.0 means for game authors.** MPL-2.0 applies file by file. When you use these components as they are, your scripts, assets and the scripts you write yourself are not subject to MPL-2.0, and you may release them under any terms, including as a closed-source commercial product. Only if you modify the source files of the components above and distribute the modified versions do you need to publish those modified files under MPL-2.0.

MPL-2.0 requires a distributor to tell recipients how to obtain the source code of MPL files. When Studio exports a game, it opens the third-party notice included with the game with the version, license and matching source code address of the game runtime and the built-in plugins the game contains; the NarraLeaf React engine is listed in the same notice with its source code address. As long as you keep that notice, you do not need to provide the source code yourself when you use these components as they are.

**The asset protection component.** This component is not open source. NarraLeaf grants every author who makes a game with NarraLeaf Studio the right to copy and distribute this component, unmodified as Studio exports it, together with games made with Studio, including in commercial releases, worldwide, free of charge and without revenue share. No other rights are granted. Games exported with "Encrypt assets" off, and all web, Android and iOS exports, do not contain this component.

## 3. Third-party components

Studio places the license files of the third-party open source components in an exported game into the game automatically:

- `THIRD-PARTY-NOTICES.txt` lists every open source package the game actually contains, with its version, license, source code address and license text. It sits beside the executable in desktop builds and at the site root of web exports. It lists only what that game contains; a web export, for example, does not list components used only by desktop builds.
- Desktop builds also contain `LICENSE.electron.txt` (Electron, MIT license) and `LICENSES.chromium.html` (the licenses of Chromium and its components).

Most of these components use MIT, BSD, ISC or Apache licenses, whose common condition is that the copyright notice and license text travel with the software. Keep these files, unrenamed, when you distribute your game. Beyond that, these licenses do not require credits on screen or in the end credits.

## 4. Credits

When you release a game made with Studio, you do not need to mention NarraLeaf Studio or NarraLeaf React on a splash screen, title screen or in the credits, or keep any engine logo. You may do so if you wish, but it is not a condition.

The only requirement is to keep the license files described in section 3. Note also that MPL-2.0 does not grant any right to use the NarraLeaf name or logos.

## 5. When you need a license of your own

- **Live2D.** Studio neither contains nor downloads the Live2D Cubism SDK. To use Live2D characters, you download the SDK from Live2D yourself and accept Live2D's license terms. Whether a game using Live2D may be released commercially, and whether a publication license agreement is needed, is governed by Live2D's terms.
- **Spine.** Studio neither contains nor downloads the Spine runtime. Using Spine animations requires a valid Spine license of your own, and including the Spine Runtimes License text with your game as that license requires.
- **Third-party plugins and templates.** Content in the plugin store and the UI template store is published by its authors under their own licenses. Dependencies a third-party plugin ships with a game are not listed in the `THIRD-PARTY-NOTICES.txt` Studio generates; accounting for them is the plugin author's responsibility.
- **Assets you import.** For images, audio, video, fonts, models and AI-generated content, it is your responsibility to confirm that their licenses allow them to be used and distributed in your game.
- **The skeleton template's example assets.** Its backgrounds and audio are CC0 (public domain dedication) and free to use; their sources are recorded in the template's `CREDITS.md` inside the Studio installation.

## 6. Modifying and distributing Studio itself

You may modify and redistribute NarraLeaf Studio under MPL-2.0. When you distribute a modified version, the modified MPL files must be published as source code under MPL-2.0. The asset protection component is not open source and is not provided with the source code.

## 7. Disclaimer and contact

NarraLeaf Studio and its components are provided "as is", without warranty of any kind, express or implied; see the license texts (MPL-2.0 sections 6 and 7).

Licensing questions: email support@mewbaka.cn, or ask on GitHub: https://github.com/NarraLeaf/NarraLeaf-Studio/issues
