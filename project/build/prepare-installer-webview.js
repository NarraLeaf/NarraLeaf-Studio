// Builds the NSIS plugin that hosts a WebView2 inside the Windows installer window.
//
//   node project/build/prepare-installer-webview.js
//
// Run it when project/installer/webview2/NlWebView.cpp changes. The result
// (project/installer/plugins/x86-unicode/NlWebView.dll) is COMMITTED, not produced during
// packaging, for the same reason the installer bitmaps are: electron-builder resolves plugin
// directories while packing, and an asset that is missing at that moment is skipped with a log
// line rather than a failure. Committing it also means neither CI nor a maintainer packaging a
// release needs a C++ toolchain - only whoever changes the plugin does.
//
// Windows-only by construction: it compiles a Win32 DLL, and the thing it goes into is the Windows
// installer. On any other host it exits without doing anything, so `yarn pack-electron --mac` on a
// Mac does not trip over it.
//
// x86, always. NSIS stubs are 32-bit whatever the target architecture of the app they install, so
// the plugin has to be too - see the note on EBWebView\x86 below for why that still reaches a
// 64-bit WebView2 runtime.

const { execFileSync, execSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { path7za } = require('7zip-bin');

const rootDir = path.resolve(__dirname, '..', '..');
const pluginSourceDir = path.join(rootDir, 'project', 'installer', 'webview2');
const sdkDir = path.join(pluginSourceDir, '.sdk');
const outputDir = path.join(rootDir, 'project', 'installer', 'plugins', 'x86-unicode');
const outputDll = path.join(outputDir, 'NlWebView.dll');

/**
 * The WebView2 SDK, pinned.
 *
 * Only two files out of the package are used: the header, and the *static* loader. Static so the
 * plugin stays a single DLL - NSIS copies plugins into $PLUGINSDIR one file at a time, and a
 * companion WebView2Loader.dll beside it would be one more thing to get wrong for no gain.
 *
 * The checksum is written down here rather than fetched, because a checksum published next to the
 * payload proves only that the two agree. This is the same reasoning (and the same shape) as the
 * pinned assets in prepare-ffmpeg.js.
 */
const SDK_VERSION = '1.0.4129.50';
const SDK_URL = `https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${SDK_VERSION}`;
const SDK_SHA256 = 'd3934f482d484b89fb4825df720c710664e1143a1e90f7b3a60794ef33f473d2';

/** What the SDK is unpacked down to. Everything else in the 9 MB package is for other targets. */
const SDK_FILES = {
    header: path.join('build', 'native', 'include', 'WebView2.h'),
    loader: path.join('build', 'native', 'x86', 'WebView2LoaderStatic.lib'),
};

function log(message) {
    console.log(`[installer-webview] ${message}`);
}

async function download(url, expectedSha256) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(buffer).digest('hex');
    if (actual !== expectedSha256) {
        // Loud on purpose: a mismatch means these are not the bytes this plugin was reviewed
        // against, and linking them anyway would put unaudited code inside the installer.
        throw new Error(
            `checksum mismatch for ${url}\n  expected ${expectedSha256}\n  actual   ${actual}`,
        );
    }
    return buffer;
}

/**
 * Unpack the two files the build needs, keyed on the pinned version so a re-run is free.
 *
 * `.sdk/` is gitignored. It holds nothing that is not reproducible from the constants above, and
 * vendoring a 2.9 MB generated header plus a 10 MB static library into the repository to save one
 * download would be the wrong trade.
 */
async function ensureSdk() {
    const stamp = path.join(sdkDir, 'version.txt');
    const header = path.join(sdkDir, path.basename(SDK_FILES.header));
    const loader = path.join(sdkDir, path.basename(SDK_FILES.loader));

    const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : null;
    if (current === SDK_VERSION && fs.existsSync(header) && fs.existsSync(loader)) {
        log(`SDK ${SDK_VERSION} already staged`);
        return { header, loader };
    }

    log(`fetching WebView2 SDK ${SDK_VERSION}`);
    const archive = await download(SDK_URL, SDK_SHA256);

    fs.rmSync(sdkDir, { recursive: true, force: true });
    fs.mkdirSync(sdkDir, { recursive: true });

    // A .nupkg is a zip; 7za will not infer that from the extension, so it is handed a copy that
    // says so rather than being told the format.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-webview2-'));
    try {
        const zip = path.join(scratch, 'webview2.zip');
        fs.writeFileSync(zip, archive);
        execFileSync(path7za, ['x', zip, `-o${scratch}`, '-y', SDK_FILES.header, SDK_FILES.loader], {
            stdio: 'pipe',
        });
        fs.copyFileSync(path.join(scratch, SDK_FILES.header), header);
        fs.copyFileSync(path.join(scratch, SDK_FILES.loader), loader);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }

    fs.writeFileSync(stamp, `${SDK_VERSION}\n`);
    log('SDK staged');
    return { header, loader };
}

/**
 * Find vcvarsall.bat.
 *
 * vswhere first, because it is the only supported answer and it copes with side-by-side editions;
 * the hardcoded fallbacks exist because vswhere ships with the *Installer*, which a machine that
 * has Build Tools laid down by other means can be missing.
 */
function findVcvarsall() {
    const vswhere = path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Microsoft Visual Studio', 'Installer', 'vswhere.exe',
    );
    if (fs.existsSync(vswhere)) {
        try {
            const installPath = execFileSync(vswhere, [
                '-latest', '-products', '*',
                '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                '-property', 'installationPath',
            ], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
            if (installPath) {
                const candidate = path.join(installPath, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch {
            // Falls through to the scan below - vswhere failing is not fatal, only unhelpful.
        }
    }

    const roots = [
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        process.env.ProgramFiles || 'C:\\Program Files',
    ];
    for (const root of roots) {
        const vsRoot = path.join(root, 'Microsoft Visual Studio');
        if (!fs.existsSync(vsRoot)) continue;
        for (const year of fs.readdirSync(vsRoot).sort().reverse()) {
            const editions = path.join(vsRoot, year);
            if (!fs.statSync(editions).isDirectory()) continue;
            for (const edition of fs.readdirSync(editions)) {
                const candidate = path.join(editions, edition, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
                if (fs.existsSync(candidate)) return candidate;
            }
        }
    }

    throw new Error(
        'no MSVC toolchain found. Install "Desktop development with C++" (Visual Studio Build Tools '
        + 'is enough) and re-run. Only whoever edits the plugin needs this - the built DLL is '
        + 'committed.',
    );
}

function build(sdk) {
    const vcvarsall = findVcvarsall();
    log(`toolchain: ${vcvarsall}`);

    const objDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-webview2-obj-'));
    // Named explicitly rather than given as an output *directory*: a quoted path ending in a
    // backslash reaches cl.exe as an escaped quote, and the argument after it is swallowed.
    const objFile = path.join(objDir, 'NlWebView.obj');
    fs.mkdirSync(outputDir, { recursive: true });

    // /MT, not /MD: the plugin is loaded into an NSIS stub that has no VC runtime beside it and no
    // way to install one. /GS- and the absent CRT startup keep it small enough that it does not
    // dominate the installer's own header.
    const compile = [
        'cl', '/nologo', '/c', '/EHsc', '/MT', '/O1', '/W3', '/GS-',
        '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN',
        `/I"${path.dirname(sdk.header)}"`,
        `/Fo"${objFile}"`,
        `"${path.join(pluginSourceDir, 'NlWebView.cpp')}"`,
    ].join(' ');

    const link = [
        'link', '/nologo', '/DLL', '/SUBSYSTEM:WINDOWS', '/OPT:REF', '/OPT:ICF',
        `/OUT:"${outputDll}"`,
        `"${objFile}"`,
        `"${sdk.loader}"`,
        'ole32.lib', 'oleaut32.lib', 'user32.lib', 'gdi32.lib', 'shlwapi.lib', 'advapi32.lib',
        'version.lib', 'shell32.lib', 'comctl32.lib',
    ].join(' ');

    try {
        // execSync, not execFileSync on cmd.exe: passing a command line with nested quotes as a
        // single argv entry gets it re-quoted on the way to cmd, and the toolchain then receives
        // paths with the quotes in the wrong places. Node builds the `cmd /d /s /c "..."` wrapper
        // itself here, which is the one arrangement cmd parses back the way it was written.
        execSync(`call "${vcvarsall}" x86 >nul 2>nul && ${compile} && ${link}`, { stdio: 'inherit' });
    } finally {
        fs.rmSync(objDir, { recursive: true, force: true });
        // link.exe drops an import library and an exports file beside the DLL; neither is used by
        // anything and both would otherwise be committed alongside it.
        for (const stray of ['NlWebView.lib', 'NlWebView.exp']) {
            fs.rmSync(path.join(outputDir, stray), { force: true });
        }
    }

    const { size } = fs.statSync(outputDll);
    log(`built ${path.relative(rootDir, outputDll)} (${(size / 1024).toFixed(0)} KB)`);
}

async function main() {
    if (process.platform !== 'win32') {
        log(`nothing to do on ${process.platform}`);
        return;
    }
    const sdk = await ensureSdk();
    build(sdk);
}

main().catch(error => {
    console.error(`[installer-webview] ${error.message}`);
    process.exit(1);
});
