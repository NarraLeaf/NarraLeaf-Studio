/** `build` - production build dialog, platform/format labels, and status toasts. */
export const build = {
    dialog: {
        title: "Build for distribution",
        start: "Build",
        runningTitle: "Build in progress",
        runningBody: "A build is already running for this project. Its progress is in the console.",
        viewConsole: "View console",
        cancelBuild: "Cancel build",
    },
    platform: {
        windows: "Windows",
        macos: "macOS",
        linux: "Linux",
        web: "Web",
        android: "Android",
        ios: "iOS",
    },
    unavailable: {
        windows: "Cannot build Windows apps on this machine.",
        macos: "macOS apps can only be built on a Mac.",
        linux: "Cannot build Linux apps on this machine.",
        web: "Web builds are available on every machine.",
        android: "Android builds are available on every machine.",
        ios: "iOS builds are available on every machine.",
    },
    format: {
        zip: "Portable ZIP",
        nsis: "Installer",
        dmg: "Disk image",
        appimage: "AppImage",
        dir: "Folder",
        apk: "APK",
        aab: "AAB",
        ipa: "IPA",
    },
    outputDir: "Output folder",
    chooseFolder: "Choose folder…",
    // The rail. Six of these name a section a finding can be filed against; `variant` names the page
    // that picks which edition every other page describes, and is shown only for a project that has
    // an edition to pick. `plugins` is shown only where an installed plugin asks for a value.
    section: {
        variant: "Variant",
        targets: "Targets",
        identity: "Identity",
        // Short enough for the rail; the section itself covers protection too.
        content: "Content",
        // The values plugins ask for. What ships is listed under Content, which is a different fact.
        plugins: "Plugins",
        signing: "Signing",
        output: "Output",
    },
    arch: {
        label: "Architecture",
        x64: "Intel / AMD (x64)",
        arm64: "ARM (arm64)",
        universal: "Universal",
    },
    // The first page: which edition is being built, and what that edition comes to.
    variant: {
        // Beside a value the selected variant does not state, so a reading that matches the App page
        // says why on the same line that an overridden one does.
        inherited: "From the project",
        // Where this variant's story stops. Counted from the cut points naming it, so the release
        // variant - which no cut point can name - always reads as the whole story.
        boundary: "Story end",
        endsNever: "Plays to the end of the story.",
        endsAt: {
            one: "Ends at {count} cut point. Nothing after it is in this build.",
            other: "Ends at {count} cut points. Nothing after them is in this build.",
        },
        variantRows: {
            one: "{count} row reads the variant and can differ between builds.",
            other: "{count} rows read the variant and can differ between builds.",
        },
        blocking: "Blocking this build",
        blockingNone: "Nothing is blocking this build.",
    },
    identity: {
        // Names the choice made on the first page, and labels the list that makes it.
        variant: "Build variant",
        // Sits beside a reading the selected variant states rather than inherits, so a value that
        // differs from the App page has its reason on the same line.
        fromVariant: "From the build variant",
        version: "Version",
        productName: "Product name",
        productNameSource: "From the project name",
        appId: "App ID",
        copyright: "Copyright",
        icons: "Icons",
        iconsHint: "Click an icon to change it in project settings",
        iconUnset: "Not set",
        // What an empty version or copyright reads as. The section only reports these now, so a blank
        // field has to say it is blank rather than look like a control waiting for input.
        notSet: "Not set",
        editInProject: "Edit in Project ▸ App",
    },
    content: {
        protection: "Asset protection",
        protectionOn: "Assets and saves are encrypted in the packaged game.",
        protectionOff: "Assets and saves ship unencrypted.",
        plugins: "Bundled plugins",
        pluginsNone: "No plugins are bundled with this game.",
        pluginsRescanUnavailable: "The plugin list cannot be rescanned in this window.",
        locales: "Bundled languages",
        localesNone: "No localization is set up. The game ships in one language.",
        localeSource: "{name} (source)",
        network: "Network policy",
        networkPolicyName: {
            off: "No network",
            allowlist: "Allowlist",
            any: "Any address",
        },
        networkPolicy: {
            off: "The packaged game refuses every HTTP and HTTPS request.",
            allowlist: "The packaged game reaches only the addresses on the project allowlist.",
            any: "The packaged game can reach any address over HTTP or HTTPS.",
        },
    },
    /**
     * The plugins page. Field labels and descriptions come from the plugin's manifest, so the only
     * words here are the ones about a secret, which is the one value the page cannot show.
     */
    pluginConfig: {
        secretUnset: "Not set",
        // While the vault has not answered yet. "Set" is all that is known then; either of the two
        // readings below would be a claim that withdraws itself a moment later.
        secretSet: "Set",
        secretHere: "Set on this machine",
        secretElsewhere: "Set on another machine; its value is not here",
        secretEnter: "Enter a new value",
        clear: "Clear",
        secretFailed: "The value could not be stored on this machine.",
    },
    signing: {
        empty: "Select a target that can be signed.",
        // Filed under "linux" in the project config, but it is not about Linux:
        // the signatures sit beside every artifact the build writes.
        detached: "Detached signatures",
        none: "Not signed",
        missing: "Missing on this machine",
        import: "Import…",
        // The dialog reports the selection; choosing and importing happen in the panel.
        editInProject: "Manage in Project ▸ Settings",
        remove: "Remove from this machine",
        removeConfirm: "Remove {label} from this machine?",
        removeConfirmDetail: "Its key material is deleted from this machine. Projects that use it build unsigned until it is imported again.",
        removeAction: "Remove",
        chooseFile: "Choose…",
        noFile: "None",
        expires: "Expires {date}",
        expired: "Expired {date}",
        certUnsupported: "Studio cannot open this container format.",
        certUnreadable: "The certificate could not be read.",
        alias: "Key {alias}",
        keyId: "Key {keyId}",
        azure: "{account} / {profile}",
        importTitle: "Import for {platform}",
        importAction: "Import",
        aliasLocked: "Enter the keystore password",
        aliasEmpty: "No signing key in this keystore",
        keyPasswordSame: "Same as the keystore password",
        macIdentityLoading: "Reading the keychain…",
        macIdentityEmpty: "No code-signing certificate in this Mac's keychain. Install one in Keychain Access, or import a certificate file.",
        macIdentityNotDeveloperId: "not for distribution",
        notarized: "Notarized with Apple",
        notNotarized: "Not notarized; Gatekeeper warns players on first launch",
        kind: {
            "windows-pfx": "Certificate file",
            "windows-store": "Windows certificate store",
            "windows-azure": "Azure Trusted Signing",
            "macos-keychain": "Certificate in the keychain",
            "macos-apple": "Certificate file",
            "android-keystore": "Release keystore",
            "ios-apple": "Apple identity",
            "linux-gpg": "GPG key",
        },
        field: {
            kind: "Type",
            label: "Name",
            pfx: "Certificate (.pfx / .p12)",
            keystore: "Keystore",
            appleCertificate: "Certificate (.p12)",
            provisioningProfile: "Provisioning profile",
            password: "Password",
            storePassword: "Keystore password",
            keyPassword: "Key password",
            alias: "Key",
            subjectName: "Subject name",
            sha1: "Thumbprint",
            endpoint: "Endpoint",
            account: "Account",
            profile: "Certificate profile",
            publisher: "Publisher",
            keyId: "Key ID",
            gpgPath: "gpg path",
            macIdentity: "Certificate",
            notaryKey: "Notary key (.p8)",
            notaryKeyId: "Notary key ID",
            notaryIssuerId: "Notary issuer ID",
        },
    },
    output: {
        artifacts: "Artifacts",
        artifactsEmpty: "Select a target to list the files it produces.",
        openWhenDone: "Open the output folder when done",
        compression: "Compression",
        compressionMaximum: "Maximum (smallest)",
        compressionNormal: "Normal",
        compressionStore: "None (fastest)",
    },
    /**
     * What a finished build came to on disk, printed under the list of artifacts in the console.
     *
     * The numbers themselves are not translated - the shared byte formatting is the same three
     * letters in every locale Studio ships - so only the words around them live here.
     */
    size: {
        /**
         * Stands where a size would be for an artifact that could not be measured. Never "0 B":
         * an author who reads that believes the build wrote nothing.
         */
        unknown: "size unknown",
        /**
         * The one total line. It counts the artifacts it managed to measure rather than all of
         * them, so the sentence stays true when one of them could not be read.
         */
        totalOne: "Total size: {size} in 1 artifact.",
        totalMany: "Total size: {size} in {count} artifacts.",
    },
    mirror: {
        official: "official source",
        change: "Change",
    },
    preflight: {
        "no-targets": "Select at least one platform and format.",
        "unbuildable-platform": "This machine cannot build for {platform}.",
        "version-invalid": "Version {version} is not a valid semantic version; the build will fail.",
        "version-missing": "No version set; the game builds as 0.0.0.",
        "identifier-missing": "No project identifier; using the app id {appId}.",
        // The build refuses the same file, so this says what stopped rather than what was assumed.
        "variants-unreadable": "The project's build variants could not be read: {reason}",
        // Platform-neutral: a mobile build falls back to the shell's own
        // placeholder icon, not to Electron's.
        "icon-missing": "No app icon set; the NarraLeaf icon ships instead.",
        "icon-unusable": "The {platform} icon could not be read; the NarraLeaf icon ships instead.",
        "icon-low-resolution": "The {platform} icon is smaller than {minimum}×{minimum} and ships upscaled.",
        "icon-stale": "The {platform} icon has not been prepared; open Project ▸ App to bake it.",
        // The row reads as an ending and produces the same package as no row at all, so the whole
        // book ships. Names the scene rather than the row number: a build dialog has no gutter to
        // count lines in, and the scene is what the author opens.
        "cut-point-inert":
            "The cut point in {scene} ({story}) removes nothing from {variant}, so that build carries the whole story.",
        // Only for a variant that shortens the story, and answerable either way: pick a page, or
        // pick "show nothing" on the variant to keep the last frame on screen.
        "variant-ending-missing":
            "{variant} ends the story early and no page is shown when it ends. Choose one under Project ▸ App ▸ Build variants.",
        // No count in the sentence: the dialog renders findings through the plain translator, which
        // has no plural form to pick, and the number adds nothing the scene name does not.
        "variant-branch-uncut":
            "Some routes from {scene} ({story}) never reach a cut point, so {variant} ships them whole.",
        "plugins-invalid": "Plugin validation failed:\n{errors}",
        // `{platforms}` is what this one value has to be filled in for: the platform it is keyed by,
        // or every platform of the build where one value covers them all. Never empty, so the
        // sentence reads the same either way.
        "plugin-config-missing": "{plugin} needs a value for {field} to build {platforms}.",
        "plugin-secret-unavailable": "{plugin}'s {field} was set on another machine and its value is not here. Enter it again to build {platforms}.",
        // Carries the cache path so an author on an offline machine still has a
        // way through: download the file elsewhere and save it there.
        "build-dependency-unavailable":
            "{plugin} needs {dependency} for {platform}. It is not cached here, and fetching it from {url} failed "
            + "({reason}). Save it as {path} to build without a network.",
        // Not an error: the game still builds and runs. What it loses is
        // whatever that program did, with nothing in the artifact to say so.
        "sidecar-target-missing":
            "{plugin} ships no {sidecar} program for {platform}, so anything it provides is missing from that build.",
        "sidecar-crossbuild-exec-bit":
            "{plugin}'s {sidecar} program would ship into the {platform} artifact unable to run: Windows cannot mark "
            + "a file executable. Build the {targetPlatform} target on a {targetPlatform} machine.",
        "encryption-key-unavailable": "Asset protection is on, but its key could not be read.",
        "web-unprotected": "Asset protection does not apply to the web export; its files ship unprotected.",
        "progress-carry-unsupported":
            "{blueprints} carries progress between editions, and a {platform} build refuses it: a page has no shared "
            + "file to write, so both nodes take their failure branch.",
        "web-lossy-images": "Lossy image recompression is on, so the exported images are re-encoded at quality {quality} and lose detail permanently.",
        "mobile-template-missing": "The mobile shell templates are unavailable: {reason}",
        "mobile-payload-too-large": "This project's assets ({size}) exceed what a mobile package can hold.",
        "version-uncodable": "Version {version} cannot be encoded as an Android version code (major up to 2099, minor and patch up to 999).",
        "appid-android-adjusted": "The app id {appId} is not a valid Android package name; the build ships {applicationId}.",
        "bundleid-ios-adjusted": "The app id {appId} is not a valid iOS bundle identifier; the build ships {bundleId}.",
        // Names the vendors' security prompts no longer: "Gatekeeper" and "SmartScreen" are their
        // vocabulary, not the author's, and what to expect is the same either way. The `build`
        // help topic carries the longer version.
        unsigned: "Not code-signed. Players may see a security prompt the first time they open it.",
        "unsigned-android": "Signed with a local debug identity, which is only good for sideloading; an AAB signed with it is not usable as a Google Play upload key. Choose a release keystore to sign it under your own identity.",
        // The chain caveat belongs here rather than on a later error: this is
        // what an author reads while they are exporting the .p12, and a leaf-only
        // export fails the signing step outright.
        "unsigned-ios": "This .ipa is unsigned, and iOS installs nothing unsigned. Choose an Apple signing credential. Export the .p12 from Keychain Access with its issuing certificate chain, or signing fails.",
        "signing-credential-missing": "The {platform} signing credential is not on this machine; key material never travels with a project. Import it here, or clear the selection to build {platform} unsigned.",
        "signing-credential-expired": "The {platform} signing certificate is not valid today ({notBefore} to {notAfter}), so signing will fail. Renew it with the issuer and import the replacement.",
        "signing-credential-expiring": "The {platform} signing certificate expires on {notAfter}. Builds signed before then stay valid; later ones need a renewed certificate.",
        "signing-secret-unavailable": "The password for the {platform} signing credential cannot be read on this machine. Import the credential again to store it afresh.",
        "signing-tool-missing": "Signing the {platform} build needs {tool}, which is not installed on this machine. Install it, add it to PATH, then reopen this dialog.",
        "signing-host-unsupported": "This machine runs {host} and cannot sign for {platform} with the selected credential: its private key lives in a system service that only exists on that platform. Build this target on a {platform} machine.",
        "signing-needs-network": "Signing the {platform} build needs a network connection. Everything else about this build works offline.",
        "signing-macos-identity-missing": "No certificate named {identity} is in this Mac's keychain. Install it in Keychain Access, or choose another certificate here.",
        "signing-macos-identity-unusable": "The certificate {identity} cannot sign: it has expired, its private key is missing, or its issuing chain is incomplete. Open it in Keychain Access to see which.",
        "signing-macos-not-developer-id": "{identity} is not a \"Developer ID Application\" certificate. The build runs on this Mac, but Gatekeeper refuses it on anyone else's and Apple will not notarize it.",
        "signing-android-not-play": "A signed APK works for sideloading and for stores such as itch.io. Google Play takes only AAB packages: turn on the AAB format under the Android target to produce one.",
        "signing-ios-profile-mismatch": "The app id {bundleId} is not covered by the provisioning profile, which is issued for {profileAppId}. Change the project identifier, or import the profile that covers it.",
        "cross-build-download": "Cross-building for {platforms} downloads Electron on first use (cached afterwards).",
        "output-not-writable": "Cannot write to {outputDir}.",
        "output-not-empty": "The output folder is not empty. This build overwrites files with matching names.",
    },
    webStaticNotice: "The Web build is a static site for any web server. Asset encryption and the HTTP restriction do not apply to it.",
    toast: {
        submitted: "Build started. Progress is in the console.",
        done: "Build finished.",
        failed: "Build failed.",
    },
    invalidCommand: "Invalid command in {story} / {scene}: {source}",
    invalidCommandSummary: {
        one: "Build stopped: {count} invalid command. See the console.",
        other: "Build stopped: {count} invalid commands. See the console.",
    },
    /** The AppTag gate. Same shape as the invalid-command pair above: a line per site, then a count. */
    appTagUnresolved: "AppTag does not reduce to a fixed value in {story} / {scene}: {source}",
    appTagUnresolvedSummary: {
        one: "Build stopped: {count} AppTag expression does not reduce to a fixed value. See the console.",
        other: "Build stopped: {count} AppTag expressions do not reduce to a fixed value. See the console.",
    },
    /**
     * The blueprint half of the same gate: a graph whose variant test does not come out a constant.
     *
     * The first line is deliberately the sibling of `appTagUnresolved` above, because it reports the
     * same fact about the same feature and an author meets both in the same console. Three lines
     * rather than one, because the three refusals are three different things to change; each states
     * what is wrong and then the move that fixes it, the way the cut-point line does.
     */
    appTagGraphUnresolved: "App Tag does not reduce to a fixed value in {blueprint} / {graph}. Compare it with a variant name, or use its value directly.",
    appTagGraphUnknownNode: "{blueprint} / {graph} tests the variant and also uses a node this build cannot read. Move the variant test to a graph without that node.",
    appTagGraphFnHead: "The variant test in {blueprint} / {graph} decides whether an Fn exists. Move the Fn out of the branch it decides.",
    appTagGraphSummary: {
        one: "Build stopped: {count} blueprint graph does not reduce its variant test to a fixed value. See the console.",
        other: "Build stopped: {count} blueprint graphs do not reduce their variant tests to a fixed value. See the console.",
    },
    /**
     * The cut-point gate, beside the one above and refused in every build for the same reason.
     *
     * The remedy is the whole message after the fact, because there is exactly one: a cut point ends
     * the story, and only a row the scene always reaches can say where that is.
     */
    cutPointNested: "The cut point for {variant} in {story} / {scene} is inside a condition or a group. Move it to the top level of the scene.",
    cutPointNestedSummary: {
        one: "Build stopped: {count} cut point is not at the top level of its scene. See the console.",
        other: "Build stopped: {count} cut points are not at the top level of their scene. See the console.",
    },
    /**
     * The content gate: something in the project can start a scene by a name the build cannot read,
     * and this variant leaves scenes out.
     *
     * Each line carries its own remedy, because the three have different first moves and an author
     * with all three needs all three. The second half is the same in each: list the scenes it can
     * start, for this variant, in the Project panel. Only shown for a variant that removes something,
     * which is why every line names the variant.
     */
    contentBlockedStartStory: "A Start Game node in {location} picks its scene while the game runs. Pick the scene in the inspector, or list the scenes it can start in the {variant} variant.",
    contentBlockedScript: "The blueprint {location} is written in TypeScript and can start any scene. List the scenes it can start in the {variant} variant.",
    contentBlockedPlugin: "The {location} plugin can start any scene. List the scenes it can start in the {variant} variant.",
    contentBlockedSummary: {
        one: "Build stopped: {count} place can start a scene the {variant} build cannot read. See the console.",
        other: "Build stopped: {count} places can start a scene the {variant} build cannot read. See the console.",
    },
    /** A listed scene that has since been deleted. A warning, not a stop: the answer still stands. */
    contentStaleDeclaration: "A scene listed for {location} in the {variant} variant is no longer in the project.",
    /** What this variant's package came to. Only printed when it leaves something out. */
    contentKept: {
        one: "The {variant} build contains {count} scene.",
        other: "The {variant} build contains {count} scenes.",
    },
    contentDropped: "{scene} in {story} is not in this build.",
    /**
     * The reference index gate. Only for a build that removes scenes, and only for a gap in a story
     * document: a widget whose picture the index cannot identify says nothing about which scenes a
     * story can reach, and refusing over one would put every variant build behind a URL nobody can
     * resolve.
     */
    contentCoverageGap: "{location} could not be read, so what the {variant} build leaves out cannot be decided.",
    /** What `{location}` becomes for a gap that is the whole index rather than one document. */
    contentCoverageWholeProject: "The project",
    contentCoverageSummary: {
        one: "Build stopped: the {variant} build removes scenes and {count} document could not be read. See the console.",
        other: "Build stopped: the {variant} build removes scenes and {count} documents could not be read. See the console.",
    },
    /**
     * The media gate. One line per asset, then one summary.
     *
     * Each line has to be actionable on its own, because the console is what an author comes back
     * to. The two cases differ in what can be done, so they are two sentences rather than one with
     * a hedge in it: one file has a conversion waiting for it and the other has nothing inside it
     * to convert.
     */
    mediaNeedsConverting: "{asset} does not play. Convert it in the asset browser.",
    mediaNotPlayable: "{asset} contains no audio and no video. Replace the file or remove it.",
    mediaSummary: {
        one: "Build stopped: {count} asset will not play. See the console.",
        other: "Build stopped: {count} assets will not play. See the console.",
    },
    /**
     * The network gate: blueprints request the network in a project that does not allow it.
     *
     * Unconditional like the media gate above, and phrased the same way: what is wrong, then what to
     * do about it. Both remedies are named because either is valid - the author wanted the request
     * and forgot the setting, or they no longer want the request.
     */
    networkNodeDisallowed: "{blueprint} makes a network request, which this project does not allow.",
    networkSummary: {
        one: "Build stopped: {count} network node cannot run. Change the network policy in project settings, or remove the node.",
        other: "Build stopped: {count} network nodes cannot run. Change the network policy in project settings, or remove the nodes.",
    },
    networkAddressNotAllowlisted: "{blueprint} requests {url}, which is not on this project's network request allowlist.",
    networkAllowlistSummary: {
        one: "Build stopped: {count} address is not on the network request allowlist. Add the address in project settings, or change the node.",
        other: "Build stopped: {count} addresses are not on the network request allowlist. Add the addresses in project settings, or change the nodes.",
    },
    /** Printed when this computer has no converter, so the check could not be made at all. */
    mediaUnchecked: {
        one: "{count} media file was not checked. This computer has no converter.",
        other: "{count} media files were not checked. This computer has no converter.",
    },
} as const;
