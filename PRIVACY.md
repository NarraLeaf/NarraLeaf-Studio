# NarraLeaf Studio Privacy Notice

Effective: November 21, 2026. Applies to NarraLeaf Studio 2.0.0 and later.

中文版本：PRIVACY.zh-CN.md

## In short

- NarraLeaf Studio has no telemetry, no analytics and no advertising. It does not send usage data to NarraLeaf or to any third party, and it has no NarraLeaf account to sign in to. The working statistics shown on the project dashboard are kept only on your computer.
- Your projects, assets and settings stay on your computer by default, and NarraLeaf does not receive a copy of them. Data is sent to another party only when you choose to use a Team server, a version control remote or an AI tool.
- Apart from the cases listed below, Studio itself does not connect to the internet. Update checks can be turned off in Settings; every other connection happens when you open the feature or take the action concerned. Plugins are not bound by this notice.
- NarraLeaf receives no personal information through Studio, and does not sell or share any personal information.
- The runtime Studio puts into exported games contains no tracking and makes no network connections of its own.

## What stays on your computer

Studio keeps the following on your computer and never sends it anywhere by itself:

- Settings, recently opened projects and window layout
- Per-project working statistics shown on the project dashboard (edit counts and active time)
- Logs (each file is rotated at 5 MB, and at most 6 files are kept)
- Native crash dumps (never uploaded; they may contain data that was in the program's memory at the time of the crash, such as text being edited)
- Caches of downloaded files, build tools and previews
- The agent access token, version control sign-in data and code signing credentials (see the sections below)

Settings > Data lists the caches and can clear them, clear statistics, and export or reset settings.

Help > Export Logs packs the logs into a file you choose. It contains Studio's logs, the current window's console output, the current project's preview and build records, and environment information such as the software and operating system versions. The logs are not redacted and may contain file paths (which usually include your system user name), project and asset names, server addresses and error messages; check them before sharing them in public. Nothing is sent to anyone unless you send that file yourself.

## Where data is kept, for how long, and how to delete it

Studio's user data folder is:

- macOS: `~/Library/Application Support/NarraLeaf Studio`
- Windows: `%APPDATA%\NarraLeaf Studio`
- Linux: `~/.config/NarraLeaf Studio`

It holds settings and working statistics (`state/global.json`), logs (`logs`), crash dumps (`Crashpad`), the agent access token (`agent-mcp.json`), version control sign-in data (`lore-auth` on macOS) and code signing credentials (`signing`; passwords are stored encrypted with the operating system's encryption facility, and are not stored at all when it is unavailable). Studio itself does not delete crash dumps automatically. Caches that can be downloaded again are kept in an `nl-cache` folder beside the Studio installation on Windows, and in the user data folder on other platforms.

Scene history, preview logs and build records are kept in the `.nlstudio` folder inside each project, and move or disappear together with the project.

Uninstalling Studio does not delete the user data folder. To remove everything, delete the folders above after uninstalling; if the `nl-cache` folder is still there after uninstalling, it can be deleted too. Working statistics and caches can be cleared at any time in Settings > Data.

## Connections Studio makes on its own

### Update checks

Shortly after launch, and every six hours while it keeps running, Studio asks for the newest release of NarraLeaf Studio. When a newer version exists it is downloaded in the background by default. After all windows are closed, Studio keeps running in the notification area (the Dock on macOS) so that an update in progress can finish downloading, and the checks continue; they stop only when you quit Studio from the tray menu or the Dock.

- Hosts: GitHub (github.com, api.github.com and GitHub's file servers, operated by GitHub, Inc. in the United States) and GitCode (gitcode.com and api.gitcode.com, a copy of the same release files, operated by Chongqing Open Source Co-creation Technology Co., Ltd. in China). Under the automatic source Studio asks both at once and downloads a few seconds of the installer from each to compare their speed, so both receive your requests. To connect to only one of them, choose GitHub or GitCode under "Update download source".
- Sent: requests for release information and release files. As with any network request, the host can see your IP address, the time of the request and the request headers (including a User-Agent identifying the client software). An incremental download requests files that correspond to the version currently installed, from which the host can infer which version you use. The requests contain no account, device identifier, project information or usage history.
- Turn off: Settings > General, where "Check for updates automatically", "Download updates automatically" and "Update download source" can each be changed.

### Plugin store and UI template store

When you open the plugin panel (in the launcher or a workspace) or the UI template store, Studio downloads the store catalog so it can show what is available and which installed plugins have updates. Icons and posters in the catalog are downloaded as the list shows them. Plugin packages and templates are downloaded when you install them.

- Hosts: raw.githubusercontent.com and github.com, or gitcode.com, depending on "Store download source" in Settings > Network. Under Automatic the catalog is requested from GitHub and GitCode at once, so both receive the request; under Custom, the address you typed.
- Sent: requests for the catalog and the files in it. The host can see your IP address, the time of the request and the request headers.

The spelling dictionary catalog is downloaded only after you press "Browse dictionaries" in Settings, and a dictionary only after you press "Download". They use the same download source as the stores (under Custom, dictionaries are still downloaded from the official GitHub address).

## Connections you start

- **Building a game.** A desktop or mobile build may download Electron, electron-builder's tool archives, the Zig toolchain and files that a plugin declares as build dependencies. They come from their official hosts (github.com, ziglang.org and the hosts named in plugin catalogs), or from a mirror you chose in Settings > Network. Tools with a pinned digest are checked after download and cached locally. If you configure code signing for a build, Windows signing requests a timestamp server; if you configure Apple notarization credentials, the macOS app being built is uploaded to Apple's notarization service and is subject to Apple's terms.
- **Remote assets.** An asset that points at a web address is downloaded by Studio from that address when you add or refresh it. The host at that address can see your IP address and the time of the request.
- **Team and version control servers.** When you connect to a Team server, Studio exchanges the following with it as the feature requires: your user name, display name, avatar, project data, an installation identifier for this computer (created on first connection and kept, so that one account's devices can be told apart), and the name collaborators see for this computer (your computer's host name by default; it can be changed under "This machine's name" in Settings). These servers are run by you or by your team, not by NarraLeaf; their operator decides what is stored and for how long. Sign-in tokens are kept by Studio on your computer: on macOS in a `lore-auth` folder in the user data folder (accessible only to your account), without using the Keychain; on other platforms in the version control component's default credential store.
- **Trusting a server certificate.** When you connect to a Team server that uses a self-signed certificate and choose to trust it, Studio installs that server's certificate authority (CA) as a trusted root certificate in your operating system's certificate store. The trust is not limited to that server's address: your system will trust certificates this CA issues for any website. Trust only servers whose operator you know; when it is no longer needed, remove the certificate with your system's certificate management tool.
- **Links.** Links such as "Visit website", "Documentation" or "Release notes" open in your default browser and are subject to that website's own policies.
- **Proxy.** Studio's downloads use no proxy unless you turn on "Use system proxy settings" in Settings > Network.

Studio's own interface code does not access the network directly; the downloads above are made by Studio's main process, which applies size limits and checks. This rule covers Studio's own code and does not restrict plugins (see "Plugins").

## AI agents (MCP)

Agent integration is off by default. When it is on, Studio runs an MCP server on 127.0.0.1 that accepts only requests made from this computer that carry the access token and no browser origin header, which keeps web pages from sending requests to its port. The token is kept in `agent-mcp.json` in the user data folder (readable only by your account on macOS and Linux; on Windows it relies on the permissions of your user profile folder) and can be regenerated in Settings at any time. Any program on this computer that can read that file can reach the server as you.

A connected AI tool can read and change the open project, create new projects, and read files in folders you approve one by one; Studio does not open the user data folder, your home folder or the file system root to it. Whatever the AI tool sends to its own provider is governed by that provider's terms, which NarraLeaf does not control.

## Plugins

Plugins, including those from the plugin store, are written by third parties. When you install or update a plugin, Studio lists the permissions it declares, such as folders it accesses, network hosts it requests in games, helper programs it ships and features it offers to AI tools, so you can decide whether to install it.

Note that the code a plugin runs in Studio's interface shares Studio's own environment and is not technically confined by that permission list: in practice a plugin can read the data you open in Studio, access the network and act as Studio. NarraLeaf makes no guarantee about how plugins handle data. Install only plugins whose authors you trust, and read their own documentation.

## Games made with NarraLeaf Studio

The runtime Studio puts into exported games has no telemetry and makes no network connections of its own. A game connects to the internet only through features its author uses, such as network blueprint nodes, remote assets or plugins. Built-in plugins likewise take effect only when the author enables them; for example, the Steam plugin talks to the Steam client on the player's computer and is subject to Valve's terms. If your game collects anything from players, providing a privacy notice for it is your responsibility as its author.

## Third-party services

The following parties receive requests directly from your computer when the feature concerned is used, and handle them under their own privacy policies:

- GitHub (GitHub, Inc., United States): update checks and downloads, the plugin store, the UI template store, spelling dictionaries, build tool downloads. Privacy policy: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement
- GitCode (Chongqing Open Source Co-creation Technology Co., Ltd., China): a copy of the same update and store files. Privacy policy: https://docs.gitcode.com/en/docs/help/home/protocol/privacy-policy
- ziglang.org and any mirror you choose in Settings > Network: build tool downloads
- Apple: only when you configure notarization for a macOS build
- Team servers, remote asset addresses and AI providers: chosen by you or your team; NarraLeaf does not know how they handle data

All NarraLeaf can see is the aggregate statistics GitHub and GitCode give repository owners (such as download counts of release files), which contain no IP addresses or other information that identifies a person.

## Your rights

The data Studio keeps is on your own computer, and you can view, export or delete it at any time (see "Where data is kept, for how long, and how to delete it"). For data held by a third party, such as GitHub's access logs or your account on a Team server, exercise your rights of access, correction or deletion with that party under its privacy policy. NarraLeaf does not hold that data and cannot act on it for you.

## Changes and contact

This notice is published by the NarraLeaf Project and changes together with Studio; the version in each release describes that release. General questions are welcome on GitHub: https://github.com/NarraLeaf/NarraLeaf-Studio/issues . For questions involving personal information that should not be posted in public, email support@mewbaka.cn.
