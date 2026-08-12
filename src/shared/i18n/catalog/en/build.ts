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
    section: {
        targets: "Targets",
        identity: "Identity",
        // Short enough for the rail; the section itself covers protection too.
        content: "Content",
        signing: "Signing",
        output: "Output",
    },
    arch: {
        label: "Architecture",
        x64: "Intel / AMD (x64)",
        arm64: "ARM (arm64)",
        universal: "Universal",
    },
    identity: {
        // Which edition of the project this build is. First in the section, because the three
        // readings under it are the values that variant ships.
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
        networkAllowHttp: "Plain HTTP is allowed.",
        networkStrict: "Plain HTTP is blocked.",
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
        // Platform-neutral: a mobile build falls back to the shell's own
        // placeholder icon, not to Electron's.
        "icon-missing": "No app icon set; the NarraLeaf icon ships instead.",
        "icon-unusable": "The {platform} icon could not be read; the NarraLeaf icon ships instead.",
        "icon-low-resolution": "The {platform} icon is smaller than {minimum}×{minimum} and ships upscaled.",
        "icon-stale": "The {platform} icon has not been prepared; open Project ▸ App to bake it.",
        "plugins-invalid": "Plugin validation failed:\n{errors}",
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
        one: "Build stopped: {count} network node cannot run. Turn on Allow HTTP in project settings, or remove the node.",
        other: "Build stopped: {count} network nodes cannot run. Turn on Allow HTTP in project settings, or remove the nodes.",
    },
    /** Printed when this computer has no converter, so the check could not be made at all. */
    mediaUnchecked: {
        one: "{count} media file was not checked. This computer has no converter.",
        other: "{count} media files were not checked. This computer has no converter.",
    },
} as const;
