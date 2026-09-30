/**
 * Every name - every file and folder, at every depth - in two real Electron release archives, as
 * `zipinfo -1` lists them, split on `/` and de-duplicated.
 *
 *  - `electron-v38.8.6-win32-x64.zip`, the archive electron-builder and `node_modules/electron`
 *    download for Windows.
 *  - `electron-v38.8.6-darwin-arm64.zip`, the same for Apple Silicon: one `Electron.app`, whose
 *    `.lproj` folders are most of the list.
 *
 * Names rather than paths because the rules they are held against match names. Captured from the
 * archives in @electron/get's cache; when Electron is upgraded, capture the new pair the same way
 * and replace both lists, so the test keeps asking about the release that actually ships.
 */

export const ELECTRON_WIN32_X64_RELEASE_NAMES: readonly string[] = [
    "LICENSE", "LICENSES.chromium.html", "af.pak", "am.pak", "ar.pak", "bg.pak", "bn.pak", "ca.pak",
    "chrome_100_percent.pak", "chrome_200_percent.pak", "cs.pak", "d3dcompiler_47.dll", "da.pak",
    "de.pak", "default_app.asar", "dxcompiler.dll", "dxil.dll", "el.pak", "electron.exe",
    "en-GB.pak", "en-US.pak", "es-419.pak", "es.pak", "et.pak", "fa.pak", "ffmpeg.dll", "fi.pak",
    "fil.pak", "fr.pak", "gu.pak", "he.pak", "hi.pak", "hr.pak", "hu.pak", "icudtl.dat", "id.pak",
    "it.pak", "ja.pak", "kn.pak", "ko.pak", "libEGL.dll", "libGLESv2.dll", "locales", "lt.pak",
    "lv.pak", "ml.pak", "mr.pak", "ms.pak", "nb.pak", "nl.pak", "pl.pak", "pt-BR.pak", "pt-PT.pak",
    "resources", "resources.pak", "ro.pak", "ru.pak", "sk.pak", "sl.pak", "snapshot_blob.bin",
    "sr.pak", "sv.pak", "sw.pak", "ta.pak", "te.pak", "th.pak", "tr.pak", "uk.pak", "ur.pak",
    "v8_context_snapshot.bin", "version", "vi.pak", "vk_swiftshader.dll", "vk_swiftshader_icd.json",
    "vulkan-1.dll", "zh-CN.pak", "zh-TW.pak",
];

export const ELECTRON_DARWIN_ARM64_RELEASE_NAMES: readonly string[] = [
    "A", "Contents", "Current", "Electron", "Electron Framework", "Electron Framework.framework",
    "Electron Helper", "Electron Helper (GPU)", "Electron Helper (GPU).app",
    "Electron Helper (Plugin)", "Electron Helper (Plugin).app", "Electron Helper (Renderer)",
    "Electron Helper (Renderer).app", "Electron Helper.app", "Electron.app", "Frameworks",
    "Helpers", "Info.plist", "LICENSE", "LICENSES.chromium.html", "Libraries", "MacOS",
    "MainMenu.nib", "Mantle", "Mantle.framework", "PkgInfo", "ReactiveObjC",
    "ReactiveObjC.framework", "Resources", "ShipIt", "Squirrel", "Squirrel.framework", "Versions",
    "af.lproj", "af_FEMININE.lproj", "af_MASCULINE.lproj", "af_NEUTER.lproj", "am.lproj",
    "am_FEMININE.lproj", "am_MASCULINE.lproj", "am_NEUTER.lproj", "ar.lproj", "ar_FEMININE.lproj",
    "ar_MASCULINE.lproj", "ar_NEUTER.lproj", "bg.lproj", "bg_FEMININE.lproj", "bg_MASCULINE.lproj",
    "bg_NEUTER.lproj", "bn.lproj", "bn_FEMININE.lproj", "bn_MASCULINE.lproj", "bn_NEUTER.lproj",
    "ca.lproj", "ca_FEMININE.lproj", "ca_MASCULINE.lproj", "ca_NEUTER.lproj",
    "chrome_100_percent.pak", "chrome_200_percent.pak", "chrome_crashpad_handler", "cs.lproj",
    "cs_FEMININE.lproj", "cs_MASCULINE.lproj", "cs_NEUTER.lproj", "da.lproj", "da_FEMININE.lproj",
    "da_MASCULINE.lproj", "da_NEUTER.lproj", "de.lproj", "de_FEMININE.lproj", "de_MASCULINE.lproj",
    "de_NEUTER.lproj", "default_app.asar", "el.lproj", "el_FEMININE.lproj", "el_MASCULINE.lproj",
    "el_NEUTER.lproj", "electron.icns", "en.lproj", "en_FEMININE.lproj", "en_GB.lproj",
    "en_GB_FEMININE.lproj", "en_GB_MASCULINE.lproj", "en_GB_NEUTER.lproj", "en_MASCULINE.lproj",
    "en_NEUTER.lproj", "es.lproj", "es_419.lproj", "es_419_FEMININE.lproj",
    "es_419_MASCULINE.lproj", "es_419_NEUTER.lproj", "es_FEMININE.lproj", "es_MASCULINE.lproj",
    "es_NEUTER.lproj", "et.lproj", "et_FEMININE.lproj", "et_MASCULINE.lproj", "et_NEUTER.lproj",
    "fa.lproj", "fa_FEMININE.lproj", "fa_MASCULINE.lproj", "fa_NEUTER.lproj", "fi.lproj",
    "fi_FEMININE.lproj", "fi_MASCULINE.lproj", "fi_NEUTER.lproj", "fil.lproj", "fil_FEMININE.lproj",
    "fil_MASCULINE.lproj", "fil_NEUTER.lproj", "fr.lproj", "fr_FEMININE.lproj",
    "fr_MASCULINE.lproj", "fr_NEUTER.lproj", "gu.lproj", "gu_FEMININE.lproj", "gu_MASCULINE.lproj",
    "gu_NEUTER.lproj", "he.lproj", "he_FEMININE.lproj", "he_MASCULINE.lproj", "he_NEUTER.lproj",
    "hi.lproj", "hi_FEMININE.lproj", "hi_MASCULINE.lproj", "hi_NEUTER.lproj", "hr.lproj",
    "hr_FEMININE.lproj", "hr_MASCULINE.lproj", "hr_NEUTER.lproj", "hu.lproj", "hu_FEMININE.lproj",
    "hu_MASCULINE.lproj", "hu_NEUTER.lproj", "icudtl.dat", "id.lproj", "id_FEMININE.lproj",
    "id_MASCULINE.lproj", "id_NEUTER.lproj", "it.lproj", "it_FEMININE.lproj", "it_MASCULINE.lproj",
    "it_NEUTER.lproj", "ja.lproj", "ja_FEMININE.lproj", "ja_MASCULINE.lproj", "ja_NEUTER.lproj",
    "kn.lproj", "kn_FEMININE.lproj", "kn_MASCULINE.lproj", "kn_NEUTER.lproj", "ko.lproj",
    "ko_FEMININE.lproj", "ko_MASCULINE.lproj", "ko_NEUTER.lproj", "libEGL.dylib", "libGLESv2.dylib",
    "libffmpeg.dylib", "libvk_swiftshader.dylib", "locale.pak", "lt.lproj", "lt_FEMININE.lproj",
    "lt_MASCULINE.lproj", "lt_NEUTER.lproj", "lv.lproj", "lv_FEMININE.lproj", "lv_MASCULINE.lproj",
    "lv_NEUTER.lproj", "ml.lproj", "ml_FEMININE.lproj", "ml_MASCULINE.lproj", "ml_NEUTER.lproj",
    "mr.lproj", "mr_FEMININE.lproj", "mr_MASCULINE.lproj", "mr_NEUTER.lproj", "ms.lproj",
    "ms_FEMININE.lproj", "ms_MASCULINE.lproj", "ms_NEUTER.lproj", "nb.lproj", "nb_FEMININE.lproj",
    "nb_MASCULINE.lproj", "nb_NEUTER.lproj", "nl.lproj", "nl_FEMININE.lproj", "nl_MASCULINE.lproj",
    "nl_NEUTER.lproj", "pl.lproj", "pl_FEMININE.lproj", "pl_MASCULINE.lproj", "pl_NEUTER.lproj",
    "pt_BR.lproj", "pt_BR_FEMININE.lproj", "pt_BR_MASCULINE.lproj", "pt_BR_NEUTER.lproj",
    "pt_PT.lproj", "pt_PT_FEMININE.lproj", "pt_PT_MASCULINE.lproj", "pt_PT_NEUTER.lproj",
    "resources.pak", "ro.lproj", "ro_FEMININE.lproj", "ro_MASCULINE.lproj", "ro_NEUTER.lproj",
    "ru.lproj", "ru_FEMININE.lproj", "ru_MASCULINE.lproj", "ru_NEUTER.lproj", "sk.lproj",
    "sk_FEMININE.lproj", "sk_MASCULINE.lproj", "sk_NEUTER.lproj", "sl.lproj", "sl_FEMININE.lproj",
    "sl_MASCULINE.lproj", "sl_NEUTER.lproj", "sr.lproj", "sr_FEMININE.lproj", "sr_MASCULINE.lproj",
    "sr_NEUTER.lproj", "sv.lproj", "sv_FEMININE.lproj", "sv_MASCULINE.lproj", "sv_NEUTER.lproj",
    "sw.lproj", "sw_FEMININE.lproj", "sw_MASCULINE.lproj", "sw_NEUTER.lproj", "ta.lproj",
    "ta_FEMININE.lproj", "ta_MASCULINE.lproj", "ta_NEUTER.lproj", "te.lproj", "te_FEMININE.lproj",
    "te_MASCULINE.lproj", "te_NEUTER.lproj", "th.lproj", "th_FEMININE.lproj", "th_MASCULINE.lproj",
    "th_NEUTER.lproj", "tr.lproj", "tr_FEMININE.lproj", "tr_MASCULINE.lproj", "tr_NEUTER.lproj",
    "uk.lproj", "uk_FEMININE.lproj", "uk_MASCULINE.lproj", "uk_NEUTER.lproj", "ur.lproj",
    "ur_FEMININE.lproj", "ur_MASCULINE.lproj", "ur_NEUTER.lproj", "v8_context_snapshot.arm64.bin",
    "version", "vi.lproj", "vi_FEMININE.lproj", "vi_MASCULINE.lproj", "vi_NEUTER.lproj",
    "vk_swiftshader_icd.json", "zh_CN.lproj", "zh_CN_FEMININE.lproj", "zh_CN_MASCULINE.lproj",
    "zh_CN_NEUTER.lproj", "zh_TW.lproj", "zh_TW_FEMININE.lproj", "zh_TW_MASCULINE.lproj",
    "zh_TW_NEUTER.lproj",
];
