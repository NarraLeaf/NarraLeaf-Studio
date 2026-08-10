; NSIS customizations for the Windows installer.
;
; electron-builder includes this file in the *header* of the generated script - before
; `!include MUI2.nsh` and before any MUI page macro is inserted (see
; app-builder-lib/out/targets/nsis/NsisTarget.js, computeCommonInstallerScriptHeader). That is
; what makes both of the things below possible; the `customHeader` hook, which looks like the
; obvious place for them, is inserted *after* the pages and would be too late for any MUI define.

; ----------------------------------------------------------------------------------------------
; Make the installer DPI-aware.
;
; NSIS does not do this by default, and neither does electron-builder (`ManifestDPIAware` does not
; appear anywhere in app-builder-lib). Without it Windows renders the whole window at 96 DPI and
; bitmap-stretches the result, which is why the installer looked soft and low-resolution on every
; scaled display - the complaint that started this work.
;
; The bitmaps are supplied at 2x and MUI's default `FitControl` stretch
; (Contrib/Modern UI 2/Interface.nsh) resizes them to whatever the control measures, so turning
; this on makes the text crisp without leaving the graphics undersized. That pairing is the point:
; DPI awareness on its own would render a 96-DPI-sized logo in a larger dialog.
ManifestDPIAware true

; ----------------------------------------------------------------------------------------------
; A welcome page.
;
; electron-builder's assisted installer has none - its first page is "Choose Installation Options"
; (templates/nsis/assistedInstaller.nsh), which opens on a question before saying what is being
; installed. This hook is inserted immediately before that page.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
