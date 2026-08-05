# Drive a native Win32 file dialog owned by one process, without taking the foreground.
#
# Electron's dialog.showOpenDialog / showSaveDialog run their own COM input loop, so CDP cannot
# reach them: a feature that opens one is otherwise unverifiable end to end. This is the recipe that
# works, and every line of it is a thing that was tried and failed first:
#
#   -List             enumerate the dialog's controls (ids differ per dialog kind: the save box is
#                     Edit id=1001, the open box Edit id=1148, the folder box Edit id=1152)
#   -Text <path>      type a path and submit
#   -Cancel           WM_CLOSE every dialog this process owns (clears a stack before a fresh run)
#
#   * PostMessage, never SendMessage - SendMessage blocks on the dialog's thread and hangs the
#     verification process itself.
#   * WM_CHAR per character, never WM_SETTEXT - WM_SETTEXT updates the box while the dialog's own
#     idea of the selection stays empty, so it submits as though nothing had been typed.
#   * BM_CLICK to the OK button itself; WM_COMMAND to the dialog frame does nothing on the Common
#     Item Dialog, and Enter into the edit does nothing either.
#   * Read the box back with SendMessageTimeout(WM_GETTEXT) - GetWindowText returns "" for another
#     process's Edit, which reads exactly like "the typing failed".
#   * Filtered by pid, always. #32770 is the generic Win32 dialog class and half the machine has one
#     open; an unfiltered sweep once closed someone's mail client.
#   * More than one dialog owned by the process is refused rather than guessed at: EnumWindows order
#     follows z-order, so typing lands in one and the submit in another, silently.
#   * Saving over an existing name raises an overwrite confirmation that ignores synthetic messages
#     and blocks everything behind it. Export to a name that does not exist yet.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads a UTF-8-no-BOM script as ANSI.
param(
    [Parameter(Mandatory = $true)][int]$ProcId,
    [string]$Text,
    [switch]$List,
    [switch]$Cancel
)

$sig = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Dlg {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder buf, int max);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
if (-not ("Win32Dlg" -as [type])) { Add-Type -TypeDefinition $sig }

function Get-DialogWindows([int]$pid_) {
    $found = New-Object System.Collections.ArrayList
    $cb = [Win32Dlg+EnumProc] {
        param($hWnd, $lParam)
        $owner = 0
        [void][Win32Dlg]::GetWindowThreadProcessId($hWnd, [ref]$owner)
        if ($owner -ne $pid_) { return $true }
        $cls = New-Object System.Text.StringBuilder 256
        [void][Win32Dlg]::GetClassName($hWnd, $cls, 256)
        if ($cls.ToString() -ne "#32770") { return $true }
        $title = New-Object System.Text.StringBuilder 512
        [void][Win32Dlg]::GetWindowText($hWnd, $title, 512)
        [void]$found.Add([pscustomobject]@{ Hwnd = $hWnd; Title = $title.ToString() })
        return $true
    }
    [void][Win32Dlg]::EnumWindows($cb, [IntPtr]::Zero)
    return $found
}

function Get-Children([IntPtr]$parent) {
    $kids = New-Object System.Collections.ArrayList
    $cb = [Win32Dlg+EnumProc] {
        param($hWnd, $lParam)
        $cls = New-Object System.Text.StringBuilder 256
        [void][Win32Dlg]::GetClassName($hWnd, $cls, 256)
        [void]$kids.Add([pscustomobject]@{
            Hwnd    = $hWnd
            Class   = $cls.ToString()
            CtrlId  = [Win32Dlg]::GetDlgCtrlID($hWnd)
            Visible = [Win32Dlg]::IsWindowVisible($hWnd)
        })
        return $true
    }
    [void][Win32Dlg]::EnumChildWindows($parent, $cb, [IntPtr]::Zero)
    return $kids
}

$dialogs = Get-DialogWindows $ProcId
if ($dialogs.Count -eq 0) { Write-Output "NO_DIALOG"; exit 1 }
# Stacked dialogs make "the first one" a coin flip: type into A, submit into B, nothing happens.
if ($dialogs.Count -gt 1 -and -not $Cancel) { Write-Output "MULTIPLE_DIALOGS: $($dialogs.Count)"; exit 2 }

$dlg = $dialogs[0].Hwnd
$children = Get-Children $dlg

if ($List) {
    Write-Output "DIALOG '$($dialogs[0].Title)' hwnd=$dlg"
    $children | Where-Object { $_.Class -in @("Edit", "Button", "ComboBox", "ComboBoxEx32") } |
        ForEach-Object { Write-Output ("  {0} id={1} visible={2} hwnd={3}" -f $_.Class, $_.CtrlId, $_.Visible, $_.Hwnd) }
    exit 0
}

if ($Cancel) {
    foreach ($d in $dialogs) { [void][Win32Dlg]::PostMessage($d.Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    Write-Output "CLOSED $($dialogs.Count)"
    exit 0
}

# Visible first, always. A save dialog carries a hidden Edit id=41477 as well as the real box, and
# typing into the hidden one succeeds, reads back correctly, and saves nothing - which looks exactly
# like a product that did not write the file.
$visibleEdits = $children | Where-Object { $_.Class -eq "Edit" -and $_.Visible }
$edit = $visibleEdits | Where-Object { $_.CtrlId -in @(1001, 1148, 1152, 41477) } | Select-Object -First 1
if (-not $edit) { $edit = $visibleEdits | Select-Object -First 1 }
if (-not $edit) { Write-Output "NO_EDIT"; exit 3 }

$ok = $children | Where-Object { $_.Class -eq "Button" -and $_.CtrlId -eq 1 } | Select-Object -First 1
if (-not $ok) { Write-Output "NO_OK_BUTTON"; exit 4 }

# Clear whatever is there (Ctrl+A then the text): WM_SETTEXT would update the box and not the
# dialog's own idea of the selection, which submits as if nothing had been typed.
[void][Win32Dlg]::PostMessage($edit.Hwnd, 0x00B1, [IntPtr]0, [IntPtr](-1))  # EM_SETSEL: select all
foreach ($ch in $Text.ToCharArray()) {
    [void][Win32Dlg]::PostMessage($edit.Hwnd, 0x0102, [IntPtr][int]$ch, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 6
}
Start-Sleep -Milliseconds 500

$buf = New-Object System.Text.StringBuilder 1024
$res = [IntPtr]::Zero
[void][Win32Dlg]::SendMessageTimeout($edit.Hwnd, 0x000D, [IntPtr]1024, $buf, 0x0002, 2000, [ref]$res)
Write-Output "TYPED '$($buf.ToString())' into id=$($edit.CtrlId)"

[void][Win32Dlg]::PostMessage($ok.Hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 900
$after = Get-DialogWindows $ProcId
Write-Output "SUBMITTED; dialogs left: $($after.Count)"
