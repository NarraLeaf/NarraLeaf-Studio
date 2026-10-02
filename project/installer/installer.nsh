; NSIS customizations for the Windows installer.
;
; electron-builder includes this file in the *header* of the generated script - before
; `!include MUI2.nsh` and before any MUI page macro is inserted (see
; app-builder-lib/out/targets/nsis/NsisTarget.js, computeCommonInstallerScriptHeader). That is what
; makes the two directives below possible; the `customHeader` hook, which looks like the obvious
; place for them, is inserted *after* the pages and would be too late for a MUI define.
;
; Everything else here is a macro, expanded later at one of the hooks the assisted-installer
; template offers (templates/nsis/assistedInstaller.nsh). Those hooks are the whole story of how a
; stock electron-builder wizard becomes this one:
;
;   customInit               - runs in .onInit, where the document is unpacked
;   customInstallMode        - runs inside the install-mode page's PRE, and can abort it
;   customWelcomePage        - inserted before every built-in page
;   customPageAfterChangeDir - inserted immediately before MUI_PAGE_INSTFILES, so MUI defines
;                              written here are the ones that page picks up
;   customFinishPage         - replaces MUI_PAGE_FINISH outright
;
; None of it runs for a silent install: NSIS skips pages entirely under /S, which is how
; electron-updater applies an update. That is deliberate, and it is what keeps the update path clear
; of all of this.
;
; Nothing here may be the reason an install cannot happen. The WebView2 runtime is not guaranteed on
; Windows 10, so the custom UI is gated on finding it, is only committed to once the view is
; actually up, and gives way to the stock MUI wizard in every other case.

ManifestDPIAware true

; Resolved against directories.buildResources (project/installer). Built by
; `node project/build/prepare-installer-webview.js`; see NlWebView.cpp for what it does.
!addplugindir /x86-unicode "${BUILD_RESOURCES_DIR}\plugins\x86-unicode"

; The variables below are declared inside customWelcomePage rather than here. The uninstaller is
; compiled from this same script with BUILD_UNINSTALLER set, and that pass inserts none of the
; installer hooks - so declared at file scope they would be unreferenced there, and NSIS reports an
; unreferenced variable as a warning, which electron-builder compiles with warnings as errors.

; ------------------------------------------------------------------------------------------------
; The document, unpacked before any page runs.
!macro customInit
  InitPluginsDir
  File "/oname=$PLUGINSDIR\installer.html" "${BUILD_RESOURCES_DIR}\ui\installer.html"
!macroend

; ------------------------------------------------------------------------------------------------
; Uninstall: take the file extensions with us.
;
; electron-builder's own APP_UNASSOCIATE (templates/nsis/include/FileAssociation.nsh) deletes the
; ProgId and the OpenWithProgids value, but never the `.ext` key itself - so uninstalling leaves
; `.nlproj` and `.nlspkg` registered, pointing at a ProgId that has just been deleted. Verified by
; installing and silently uninstalling a real build.
;
; Only when the extension still opens with *this* installation. An extension is not ours to take
; away: another application may have claimed it since, and deleting it unconditionally would break
; whatever did. The test is the command the shell would actually run - if it starts with the
; directory being removed, the association is about to be dead either way.
;
; This hook runs before unregisterFileAssociations does, which is what makes the lookup possible:
; the ProgId still exists to be read.
;
; The two extensions are named here because nothing in the generated script carries the list.
; Adding one to `fileAssociations` in electron-builder.yml means adding it here too.
!macro nlDropExtension EXT
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\${EXT}" ""
  ${If} $0 != ""
    ReadRegStr $1 SHELL_CONTEXT "Software\Classes\$0\shell\open\command" ""
    ; The command is written with the executable either bare or quoted, depending on the version of
    ; electron-builder; drop one leading quote so both shapes compare the same.
    StrCpy $2 $1 1
    ${If} $2 == '"'
      StrCpy $1 $1 "" 1
    ${EndIf}
    StrLen $3 "$INSTDIR"
    StrCpy $4 $1 $3
    ${If} $4 == "$INSTDIR"
      DeleteRegKey SHELL_CONTEXT "Software\Classes\${EXT}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  !insertmacro nlDropExtension ".nlproj"
  !insertmacro nlDropExtension ".nlspkg"
!macroend

; ------------------------------------------------------------------------------------------------
; Install mode.
;
; The stock flow asks "who should this be installed for" on a Win32 page of its own. Studio installs
; per user, so the question is only worth asking when a previous all-users installation is there to
; be upgraded - and that case answers itself. Setting either flag makes the page abort before it
; draws (templates/nsis/multiUserUi.nsh), which is the supported way to skip it.
;
; /allusers and /currentuser are still honoured: the page's PRE checks them ahead of this.
;
; Skipping the page does not stop it resetting $INSTDIR. Its PRE runs setInstallModePerUser (or the
; all-users twin, templates/nsis/multiUser.nsh), which recomputes the folder from the registry and
; the default location - and the template places this page *after* customWelcomePage, so it runs
; after the folder has been chosen. nlInstFilesPre puts the chosen folder back; see there.
!macro customInstallMode
  ${If} $hasPerMachineInstallation == "1"
  ${AndIf} $hasPerUserInstallation == "0"
    StrCpy $isForceMachineInstall "1"
  ${Else}
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

; ------------------------------------------------------------------------------------------------
; The custom UI.

!macro customWelcomePage

; WordFunc only defines the macros that are asked for by name.
!include "WordFunc.nsh"
!insertmacro WordReplace

Var nlCanvas    ; the child window the WebView fills; lives on $HWNDPARENT, outlives every page
Var nlWidth
Var nlHeight
Var nlState     ; "" not started | "wait" creating | "ready" ours | "off" stock wizard has it
Var nlTicks
Var nlSize      ; human-readable install size, e.g. "1.1 GB"
Var nlKiB       ; the same number unformatted, which is what the plugin measures the copy against
Var nlLocked    ; "" not settled | "1" an existing install decides the folder | "0" the user does
Var nlDir       ; the folder the user confirmed on whichever page asked; "" until one was left

; --- the window ---------------------------------------------------------------------------------

; Take the system frame off and give the window its own size, position and corners. WS_CAPTION
; (0x00C00000, itself WS_BORDER | WS_DLGFRAME), WS_THICKFRAME (0x00040000) and WS_SYSMENU
; (0x00080000) all come off: the title bar is the document's to draw, and dropping WS_THICKFRAME is
; what makes the window un-resizable, which is the intent - the layout is designed at one size.
;
; Both halves of WS_CAPTION have to go. Clearing WS_DLGFRAME alone is enough to stop the title bar
; being drawn, so the window looks finished either way, but WS_BORDER surviving costs a pixel of
; client area on each side - measured on Windows 11 at 125%, a 775x465 window had a 773x463 client.
; The canvas is a child of that client area and anything past it is clipped, so the document's last
; two rows never reached the screen. Those two rows are the whole of the progress bar, which is why
; it was absent rather than merely cut short.
;
; Called only once the WebView is confirmed up. Until then the window is merely hidden, so a machine
; where the view cannot be created gets the stock wizard with its frame untouched.
Function nlFrame
  System::Call "user32::GetWindowLongW(p $HWNDPARENT, i -16) i .r0"
  IntOp $1 $0 & 0xFE33FFFF
  System::Call "user32::SetWindowLongW(p $HWNDPARENT, i -16, i r1)"

  System::Call "user32::GetSystemMetrics(i 0) i .r6"
  System::Call "user32::GetSystemMetrics(i 1) i .r7"
  IntOp $6 $6 - $nlWidth
  IntOp $6 $6 / 2
  IntOp $7 $7 - $nlHeight
  IntOp $7 $7 / 2
  ; SWP_FRAMECHANGED (0x0020) | SWP_NOZORDER (0x0004)
  System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i r6, i r7, i $nlWidth, i $nlHeight, i 0x24)"

  ; DWMWA_WINDOW_CORNER_PREFERENCE (33) = DWMWCP_ROUND (2). Windows 10 ignores it and stays square,
  ; which is the right look there.
  System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, *i 2, i 4)"

  ; Everything the stock wizard draws on the outer window: the three buttons, the branding line and
  ; the separators. The document draws its own.
  GetDlgItem $R0 $HWNDPARENT 1
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 2
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 3
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 1028
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 1256
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 1035
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 1045
  ShowWindow $R0 ${SW_HIDE}
  GetDlgItem $R0 $HWNDPARENT 1034
  ShowWindow $R0 ${SW_HIDE}

  ; Sized from the client area rather than from $nlWidth/$nlHeight, so the document ends exactly
  ; where the window does whatever the frame turns out to cost on a given Windows. With the styles
  ; above off the two agree; this is what makes that a fact rather than an assumption, and the
  ; failure it guards against is a silent one - an oversized canvas is clipped, not scaled, and the
  ; edge that goes first is the bottom one the bar sits on.
  StrCpy $3 0
  StrCpy $4 0
  System::Call "*(i, i, i, i) p .r8"
  System::Call "user32::GetClientRect(p $HWNDPARENT, p r8)"
  System::Call "*$8(i, i, i .r3, i .r4)"
  System::Free $8
  ; Nothing above can be relied on to have answered: a System::Call that fails leaves its
  ; destinations untouched, and a canvas of zero would be a window with no document in it at all -
  ; a worse outcome than the clipped edge this replaces. Fall back to the size it used to use.
  ${If} $3 < 1
  ${OrIf} $4 < 1
    StrCpy $3 $nlWidth
    StrCpy $4 $nlHeight
  ${EndIf}
  System::Call "user32::MoveWindow(p $nlCanvas, i 0, i 0, i r3, i r4, i 1)"
  NlWebView::Fit
FunctionEnd

; The WebView's host window is a child of $HWNDPARENT rather than of any page's dialog, so one
; document survives every page transition: no reload, no flash, and the progress bar is still on
; screen while the section that drives it runs.
Function nlShell
  ; Sized in the units the document is written in, scaled once by the system DPI. The manifest above
  ; makes the process DPI-aware, so this is the scale everything downstream agrees on - the plugin
  ; pins the WebView's rasterisation to the same number.
  System::Call "user32::GetDC(p 0) p .r2"
  System::Call "gdi32::GetDeviceCaps(p r2, i 88) i .r3"
  System::Call "user32::ReleaseDC(p 0, p r2) i"
  IntOp $nlWidth 620 * $3
  IntOp $nlWidth $nlWidth / 96
  IntOp $nlHeight 372 * $3
  IntOp $nlHeight $nlHeight / 96

  ; WS_CHILD (0x40000000) | WS_VISIBLE (0x10000000)
  System::Call "user32::CreateWindowExW(i 0, w 'STATIC', w '', i 0x50000000, i 0, i 0, \
    i $nlWidth, i $nlHeight, p $HWNDPARENT, p 0, p 0, p 0) p .r0"
  StrCpy $nlCanvas $0

  ${WordReplace} "$PLUGINSDIR" "\" "/" "+" $R0
  NlWebView::Create "$nlCanvas" "$PLUGINSDIR\webview" "file:///$R0/installer.html" "0b0d12"
FunctionEnd

; NSIS builds a fresh inner dialog for every page, and each one lands above its siblings - the
; canvas included. Called once per page to put it back on top: HWND_TOP (0) with
; SWP_NOMOVE (0x0002) | SWP_NOSIZE (0x0001) | SWP_NOACTIVATE (0x0010).
Function nlRaise
  System::Call "user32::SetWindowPos(p $nlCanvas, p 0, i 0, i 0, i 0, i 0, i 0x13)"
FunctionEnd

; Undo the concealment and let the stock wizard have the window. The frame is only ever taken off
; after the view is up, so there is nothing to put back.
Function nlGiveUp
  StrCpy $nlState "off"
  NlWebView::Destroy
  ShowWindow $HWNDPARENT ${SW_SHOW}
FunctionEnd

; --- values the document shows ------------------------------------------------------------------

; The unpacked size, in the units a person reads. Taken from the same defines the stock installer
; puts on the section (templates/nsis/common.nsh, setSpaceRequired) and resolved the same way, so a
; build carrying more than one architecture still reports the one that will be installed.
Function nlMeasure
  StrCpy $0 0
  !ifdef APP_64_UNPACKED_SIZE
    !ifdef APP_32_UNPACKED_SIZE
      !ifdef APP_ARM64_UNPACKED_SIZE
        ${If} ${IsNativeARM64}
          StrCpy $0 ${APP_ARM64_UNPACKED_SIZE}
        ${ElseIf} ${IsNativeAMD64}
          StrCpy $0 ${APP_64_UNPACKED_SIZE}
        ${Else}
          StrCpy $0 ${APP_32_UNPACKED_SIZE}
        ${EndIf}
      !else
        ${If} ${RunningX64}
          StrCpy $0 ${APP_64_UNPACKED_SIZE}
        ${Else}
          StrCpy $0 ${APP_32_UNPACKED_SIZE}
        ${EndIf}
      !endif
    !else
      StrCpy $0 ${APP_64_UNPACKED_SIZE}
    !endif
  !else
    !ifdef APP_ARM64_UNPACKED_SIZE
      StrCpy $0 ${APP_ARM64_UNPACKED_SIZE}
    !else
      !ifdef APP_32_UNPACKED_SIZE
        StrCpy $0 ${APP_32_UNPACKED_SIZE}
      !endif
    !endif
  !endif

  StrCpy $nlKiB $0

  ; The defines are in KiB. One decimal place once it is gigabytes, none below that.
  ${If} $0 >= 1048576
    IntOp $1 $0 * 10
    IntOp $1 $1 / 1048576
    IntOp $2 $1 / 10
    IntOp $3 $1 % 10
    StrCpy $nlSize "$2.$3 GB"
  ${Else}
    IntOp $1 $0 / 1024
    StrCpy $nlSize "$1 MB"
  ${EndIf}
FunctionEnd

; The document carries all three of Studio's languages; this only says which to open with, and
; the picker in the corner can change it afterwards. 2052 is zh-CN and 1041 is ja-JP, matching
; nsis.installerLanguages - which governs what NSIS itself says, in the fallback wizard and in any
; message box, and cannot be re-chosen at run time the way the document can.
;
; Backslashes are doubled on the way into a JavaScript string literal: left alone, "C:\Users"
; arrives as "C:Users" and the document shows a path that does not exist.
Function nlPushInit
  ${If} $LANGUAGE == 2052
    StrCpy $R1 "zh"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $R1 "ja"
  ${Else}
    StrCpy $R1 "en"
  ${EndIf}
  ${WordReplace} "$INSTDIR" "\" "\\" "+" $R0
  NlWebView::Eval `window.nlInit("$R1", "${PRODUCT_NAME} ${VERSION}", "${PRODUCT_NAME}", "$R0", "$nlSize", "$nlLocked")`
FunctionEnd

Function nlPushDir
  ${WordReplace} "$INSTDIR" "\" "\\" "+" $R0
  NlWebView::Eval `window.nlDir("$R0")`
FunctionEnd

; --- the folder ---------------------------------------------------------------------------------
;
; Whatever folder a page shows is the folder the files go to. Three things used to get in the way of
; that, and each is handled here rather than patched up afterwards:
;
;   - the install-mode page resets $INSTDIR after the folder is chosen (see customInstallMode), so
;     the choice is recorded as $nlDir when its page is left and put back by nlInstFilesPre;
;   - a picked folder gets a folder of the product's name inside it, which used to happen at the last
;     moment, after the page had shown the folder without it - now it happens as the folder is picked,
;     so the page shows the result;
;   - an upgrade goes where the existing install is, so the page shows that folder and offers no way
;     to change it.

; Gives a picked folder a folder of its own for the files to go in, unless it already is one.
;
; The uninstaller removes the install directory recursively (templates/nsis/uninstaller.nsh), so a
; folder the user picked as a *parent* - D:\ or D:\Apps - must never become the install directory
; itself. The test is the last component of the path being exactly the product's folder name (case
; does not matter); the template's own test was a substring match, which a folder such as
; "NarraLeaf Studio Projects" passes, and an uninstall would then have taken everything in it.
Function nlWithAppFolder
  Push $0
  ; "D:\" comes back from the folder dialog with its separator; everything else without.
  StrCpy $0 $INSTDIR 1 -1
  ${If} $0 == "\"
    StrCpy $INSTDIR $INSTDIR -1
  ${EndIf}
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
  Pop $0
FunctionEnd

; Whether this process can create the folder in $R0 and write to it: the nearest part of the path
; that already exists has to accept a new file. "1" or "0" in $R1.
;
; Asked when a folder is picked rather than discovered when the copy fails. The installer runs
; unelevated for a per-user install, so a folder such as C:\Program Files is refused by Windows, and
; the first sign of it would otherwise be a write error halfway through the install. The probe is a
; uniquely named empty file, deleted at once.
Function nlCanWrite
  Push $2
  Push $3
  StrCpy $R1 "0"
  StrCpy $2 $R0
  ${Do}
    ${If} ${FileExists} "$2\*.*"
      ${Break}
    ${EndIf}
    ${GetParent} "$2" $3
    ${If} $3 == ""
    ${OrIf} $3 == $2
      Goto nlCanWriteDone
    ${EndIf}
    StrCpy $2 $3
  ${Loop}
  ClearErrors
  GetTempFileName $3 "$2"
  ${IfNot} ${Errors}
  ${AndIf} $3 != ""
    Delete $3
    StrCpy $R1 "1"
  ${EndIf}
  nlCanWriteDone:
  Pop $3
  Pop $2
FunctionEnd

; Decides, once, whether the folder is the user's to choose.
;
; An existing install in the same scope - its InstallLocation recorded and its executable still
; there - decides it: the template uninstalls the previous version from where it is and installs
; into $INSTDIR, which initMultiUser has already set to that location. Moving an install on upgrade
; would leave every pinned taskbar shortcut and any other copy of the old path pointing at a folder
; that the uninstaller has just deleted, so the page shows the folder and does not offer to change
; it. A registry entry whose folder is gone is not an install, and leaves the choice open.
;
; /D= still wins either way: initMultiUser applies it after the registry, and this only reads
; $INSTDIR. Otherwise the folder shown is given its product folder now, so a /D= that names a parent
; is shown the way it will be used.
Function nlSettle
  ${If} $nlLocked != ""
    Return
  ${EndIf}
  StrCpy $nlLocked "0"
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
    StrCpy $nlLocked "1"
  ${Else}
    Call nlWithAppFolder
  ${EndIf}
FunctionEnd

; --- the install page ---------------------------------------------------------------------------

Function nlInstallPage
  ; Ahead of the gate, so the stock wizard's pages see the same decision.
  Call nlSettle

  ; The gate. No runtime, no custom UI, and the stock wizard runs the install instead.
  NlWebView::Runtime
  Pop $0
  ${If} $0 == ""
    StrCpy $nlState "off"
    Abort
  ${EndIf}

  StrCpy $nlState "wait"
  StrCpy $nlTicks 0
  Call nlMeasure
  Call nlShell

  ; Hidden until the view has something to show. The alternative is a flash of the stock page while
  ; Chromium starts, which takes a couple of hundred milliseconds.
  ShowWindow $HWNDPARENT ${SW_HIDE}

  nsDialogs::Create 1018
  Pop $0
  Call nlRaise
  ${NSD_CreateTimer} nlInstallTick 60
  nsDialogs::Show
FunctionEnd

Function nlInstallTick
  ${If} $nlState == "wait"
    NlWebView::Ready
    Pop $0
    IntOp $nlTicks $nlTicks + 1

    ; Creation failed outright, or is taking long enough that something is wrong. Either way the
    ; window has not been touched yet, so handing it to the stock wizard costs nothing. 100 ticks is
    ; six seconds; a warm runtime is ready in three.
    ${If} $0 == "-1"
    ${OrIf} $nlTicks > 100
      ${NSD_KillTimer} nlInstallTick
      Call nlGiveUp
      Abort
    ${EndIf}

    ${If} $0 == "1"
      StrCpy $nlState "ready"
      Call nlFrame
      Call nlPushInit
      ShowWindow $HWNDPARENT ${SW_SHOW}
    ${EndIf}
    Return
  ${EndIf}

  NlWebView::Poll
  Pop $0
  ${If} $0 == "browse"
  ${AndIf} $nlLocked != "1"
    ; Opened on the folder the install would go *into*, which is where the user is choosing.
    ${GetParent} "$INSTDIR" $2
    nsDialogs::SelectFolderDialog "${PRODUCT_NAME}" "$2"
    Pop $1
    ${If} $1 != "error"
      ; Tried on $INSTDIR, and taken back if the folder cannot be written to - the page goes on
      ; showing the folder it showed before, with the reason under it.
      StrCpy $2 $INSTDIR
      StrCpy $INSTDIR $1
      Call nlWithAppFolder
      StrCpy $R0 $INSTDIR
      Call nlCanWrite
      ${If} $R1 == "1"
        Call nlPushDir
      ${Else}
        StrCpy $INSTDIR $2
        NlWebView::Eval `window.nlDirRefused()`
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

Function nlInstallLeave
  ${NSD_KillTimer} nlInstallTick
  StrCpy $nlDir $INSTDIR
FunctionEnd

Page custom nlInstallPage nlInstallLeave

; The same pages the stock wizard would have had, declared here so that giving up on the custom UI
; does not also give up on asking. Without them the fallback goes straight from a double-click into
; a running install: the install-mode page skips itself, allowToChangeInstallationDirectory is off,
; and MUI_PAGE_INSTFILES starts the section the moment it is shown. That is an ambush, not a
; degraded experience.
;
; Which set draws is decided at run time, because a page can only be dropped by aborting in its own
; PRE - the same arrangement the finish page uses.
Function nlStockPre
  ${If} $nlState == "ready"
    Abort
  ${EndIf}
FunctionEnd

; The fallback's folder page keeps the same three promises as the document (see "the folder" above).
; On an upgrade the field and its Browse button are disabled and the line above them says why, in
; the template's own words for the same situation - LangStrings it already carries in every
; installer language. The control ids are NSIS's directory page (IDC_INTROTEXT 1006, IDC_BROWSE
; 1001, IDC_DIR 1019).
Function nlStockDirShow
  ${If} $nlLocked != "1"
    Return
  ${EndIf}
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1019
  EnableWindow $1 0
  GetDlgItem $1 $0 1001
  EnableWindow $1 0
  GetDlgItem $1 $0 1006
  ${If} $installMode == "all"
    SendMessage $1 ${WM_SETTEXT} 0 "STR:$(perMachineInstallExists) $(reinstallUpgrade)"
  ${Else}
    SendMessage $1 ${WM_SETTEXT} 0 "STR:$(perUserInstallExists) $(reinstallUpgrade)"
  ${EndIf}
FunctionEnd

; A typed or browsed folder that gains its product folder here is written back into the field and
; the page stays, so the folder the files go to is on screen before anything is installed - the
; second press goes on. A folder that cannot be written to stops here too, with NSIS's own
; translated write-error text; Retry stays on the page to choose another.
Function nlStockDirLeave
  ${If} $nlLocked != "1"
    StrCpy $0 $INSTDIR
    StrCpy $1 $0 1 -1
    ${If} $1 == "\"
      StrCpy $0 $0 -1
    ${EndIf}
    Call nlWithAppFolder

    StrCpy $R0 $INSTDIR
    Call nlCanWrite
    ${If} $R1 != "1"
      ; The text names the path in $0.
      StrCpy $0 $INSTDIR
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(^FileError_NoIgnore)" IDRETRY +2
      Quit
      Abort
    ${EndIf}

    ${If} $INSTDIR != $0
      FindWindow $1 "#32770" "" $HWNDPARENT
      GetDlgItem $1 $1 1019
      SendMessage $1 ${WM_SETTEXT} 0 "STR:$INSTDIR"
      Abort
    ${EndIf}
  ${EndIf}
  StrCpy $nlDir $INSTDIR
FunctionEnd

!define MUI_PAGE_CUSTOMFUNCTION_PRE nlStockPre
!insertmacro MUI_PAGE_WELCOME

!define MUI_PAGE_CUSTOMFUNCTION_PRE nlStockPre
!define MUI_PAGE_CUSTOMFUNCTION_SHOW nlStockDirShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE nlStockDirLeave
!insertmacro MUI_PAGE_DIRECTORY

!macroend

; ------------------------------------------------------------------------------------------------
; The install itself.
;
; Inserted immediately before MUI_PAGE_INSTFILES, so the two MUI defines below are the ones that
; page picks up.
!macro customPageAfterChangeDir

; The last page callback before the section runs, and so the one place that can make the folder the
; page showed the folder that is used: every page in between, the install-mode page above all, is
; free to have reset $INSTDIR. The folder already has its product folder (nlWithAppFolder, applied as
; it was chosen); nothing is appended here, because whatever is appended here is something no page
; showed.
;
; Never reached by a silent install - NSIS runs no page callbacks under /S - which is what keeps
; /S /D= and electron-updater's silent update on exactly the folder they name.
Function nlInstFilesPre
  ${If} $nlDir != ""
    StrCpy $INSTDIR $nlDir
  ${EndIf}
FunctionEnd

Function nlInstFilesShow
  ${If} $nlState != "ready"
    Return
  ${EndIf}
  Call nlRaise
  NlWebView::Eval `window.nlState("installing")`

  ; NSIS's own progress bar, which it advances as it works. The plugin reads it on a timer of its
  ; own and calls window.nlProgress; the script cannot, because the section runs on another thread
  ; and no page loop is polling while it does.
  ;
  ; The three other arguments are what turn that reading into progress through the whole install
  ; rather than through one pass of it - see whole_install_fraction in NlWebView.cpp. `7z-out` is
  ; where the template extracts the payload before copying it into place
  ; (app-builder-lib/templates/nsis/include/extractAppPackage.nsh, extractUsing7za); naming it here
  ; is a coupling to that template, and one that costs only accuracy if it ever moves - the plugin
  ; falls back to measuring bytes against $nlKiB when the directory is not there.
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1004
  NlWebView::Track "$1" "$PLUGINSDIR\7z-out" "$INSTDIR" "$nlKiB"

  ; Hand over to the finish page as soon as the section is done - there is no visible Next to press.
  SetAutoClose true
FunctionEnd

!define MUI_PAGE_CUSTOMFUNCTION_PRE nlInstFilesPre
!define MUI_PAGE_CUSTOMFUNCTION_SHOW nlInstFilesShow

!macroend

; ------------------------------------------------------------------------------------------------
; The finish page.
;
; Two pages are declared: the document's, and the stock one behind it. Exactly one of them draws -
; whichever matches how the install was actually presented - because the choice is made at run time
; and a page can only be dropped by aborting in its own PRE.
!macro customFinishPage

; Starting Studio as the user rather than as the installer matters when the install was elevated: a
; child of an elevated process inherits the elevation, and Studio would run as administrator for the
; rest of that session. Same call the stock finish page makes.
Function nlStartApp
  ${If} ${isUpdated}
    StrCpy $1 "--updated"
  ${Else}
    StrCpy $1 ""
  ${EndIf}
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
FunctionEnd

Function nlFinishPage
  ${If} $nlState != "ready"
    Abort
  ${EndIf}

  NlWebView::Track "0" "" "" "0"
  NlWebView::Eval `window.nlProgress(1)`
  ; "Installed in ..." names the folder the section actually wrote to, not the one the document was
  ; last told about.
  Call nlPushDir
  NlWebView::Eval `window.nlState("done")`

  nsDialogs::Create 1018
  Pop $0
  Call nlRaise
  ${NSD_CreateTimer} nlFinishTick 60
  nsDialogs::Show
FunctionEnd

Function nlFinishTick
  NlWebView::Poll
  Pop $0
  ${If} $0 == "launch"
    Call nlStartApp
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
    Return
  ${EndIf}

  ; A link out of the finish screen. The document builds the URL, because the language it should be
  ; read in is the one the picker last chose and only the document knows that.
  ;
  ; The origin is checked here all the same. The page is a local file this installer wrote, so this
  ; is not defending against it - it is making sure a shell open can only ever be aimed at one host,
  ; whatever the document turns into later.
  StrCpy $1 $0 5
  ${If} $1 == "open:"
    StrCpy $2 $0 "" 5
    StrCpy $3 $2 26
    ${If} $3 == "https://www.narraleaf.com/"
      ${StdUtils.ExecShellAsUser} $4 "$2" "open" ""
    ${EndIf}
  ${EndIf}
FunctionEnd

Function nlFinishLeave
  ${NSD_KillTimer} nlFinishTick
  NlWebView::Destroy
FunctionEnd

Page custom nlFinishPage nlFinishLeave

Function nlStockFinishPre
  ${If} $nlState == "ready"
    Abort
  ${EndIf}
FunctionEnd

!define MUI_PAGE_CUSTOMFUNCTION_PRE nlStockFinishPre
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION "nlStartApp"
!insertmacro MUI_PAGE_FINISH

!macroend
