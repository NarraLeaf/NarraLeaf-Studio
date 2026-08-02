# Make one window of the isolated instance MEASURABLE, with the smallest possible effect on whoever
# is using the machine. Acceptance needs `document.hidden === false` (handoff 6.8); it does not need
# the window in front, and it never needs the window pinned there.
#
# Default mode restores a minimized window WITHOUT activating it and does nothing else. That is
# enough when the instance was launched with `--disable-features=CalculateNativeWinOcclusion`, which
# is now part of the launch recipe: with the occlusion calculator off, a fully covered window keeps
# reporting hidden=false (measured: covered window flips to hidden at ~2.1s without the flag, stays
# visible for the whole 8.4s probe with it). Minimized is a different code path and still hides,
# which is the one case this script has to fix.
#
# -Force is the old behaviour minus the pinning, for scenarios that need REAL foreground (physical
# input). It refuses to run when the window lives on another virtual desktop, because raising it
# would drag the operator's desktop along with it - moving a window to another desktop is how a
# person says "not now".
#
# Scoped by pid so it can never touch another session's Studio.
#
# KEEP THIS FILE PURE ASCII. Windows PowerShell reads a UTF-8-no-BOM script in the ANSI codepage
# (1252 here), so an em dash decodes to a right double quotation mark - which PowerShell accepts as
# a string delimiter. One em dash in a comment-free string ended the string early and the parser
# then read the next `'` as opening a new one; the reported error was 20 lines away from the cause.
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [int]$ProcId = 0,
    [switch]$Force,
    [switch]$AllowDesktopSwitch,
    [switch]$Off
)

$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

[ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVirtualDesktopManager {
  int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out int onCurrentDesktop);
  int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
  int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
}

public class FGX {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  const int SW_SHOWNOACTIVATE = 4;
  const int SW_RESTORE = 9;
  static readonly IntPtr HWND_TOPMOST = (IntPtr)(-1);
  static readonly IntPtr HWND_NOTOPMOST = (IntPtr)(-2);
  const uint SWP_NOMOVE_NOSIZE = 0x0003;

  /** Un-minimize without taking the foreground. The only thing the default mode is allowed to do. */
  public static bool Unminimize(IntPtr h) {
    if (!IsIconic(h)) return false;
    ShowWindow(h, SW_SHOWNOACTIVATE);
    return true;
  }

  /** Drop a window out of the always-on-top band. Idempotent, and the thing nobody used to call. */
  public static void Unpin(IntPtr h) {
    SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE_NOSIZE);
  }

  /**
   * Raise to the front of the normal band and take the foreground - WITHOUT pinning.
   *
   * TOPMOST then immediately NOTOPMOST is the standard bring-to-front trick: it lands the window at
   * the top of the non-topmost band and leaves nothing behind. The old version stopped after the
   * first half, so every acceptance run left a Studio window pinned over the operator's editor until
   * the process died.
   *
   * SetForegroundWindow from a background process is refused by the Windows foreground lock, so we
   * borrow the current foreground thread's input queue for the duration.
   */
  public static bool ForceForeground(IntPtr h) {
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint self = GetCurrentThreadId();
    AttachThreadInput(fgThread, self, true);
    ShowWindow(h, SW_RESTORE);
    SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE_NOSIZE);
    SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE_NOSIZE);
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(fgThread, self, false);
    return ok && GetForegroundWindow() == h;
  }

  /** "yes" / "no" / "unknown" - unknown when the shell COM object refuses to answer for this window. */
  public static string OnCurrentDesktop(IntPtr h) {
    try {
      var type = Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"));
      var mgr = (IVirtualDesktopManager)Activator.CreateInstance(type);
      int on;
      if (mgr.IsWindowOnCurrentVirtualDesktop(h, out on) != 0) return "unknown";
      return on != 0 ? "yes" : "no";
    } catch { return "unknown"; }
  }

  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public class Win { public IntPtr H; public string T; }
  public static List<Win> OfProcess(uint wantPid) {
    var found = new List<Win>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (sb.Length > 0 && (wantPid == 0 || pid == wantPid)) found.Add(new Win { H = h, T = sb.ToString() });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue

$wins = [FGX]::OfProcess([uint32]$ProcId) | Where-Object { $_.T -like 'NarraLeaf*' -or $_.T -eq 'Dev Mode' }
$target = @($wins | Where-Object { $_.T -eq $Title })

# Always sweep our own leftovers out of the topmost band, whatever the mode. Older runs of this
# script pinned windows and never unpinned them; this is what finally clears those.
foreach ($w in $wins) { [FGX]::Unpin($w.H) }

if ($Off) {
    Write-Output "unpinned=$(@($wins).Count) mode=off"
    return
}

# Unpinning every NarraLeaf window on the machine is safe and is how leftovers from the old script
# finally get cleared. Un-minimizing or raising one is NOT: without a pid this matches by title, and
# this machine routinely has two or three sessions' Studios up, all titled 'NarraLeaf - workspace'.
if ($ProcId -eq 0) {
    Write-Output "unpinned=$(@($wins).Count) mode=sweep - no -ProcId, refusing to touch windows that may belong to another session"
    return
}

if ($target.Count -eq 0) {
    Write-Output "matched=0 of $(@($wins).Count) title='$Title' - nothing to do"
    return
}

$restored = 0
foreach ($w in $target) { if ([FGX]::Unminimize($w.H)) { $restored += 1 } }

if (-not $Force) {
    Write-Output "matched=$($target.Count) of $(@($wins).Count) title='$Title' mode=show unminimized=$restored"
    return
}

$desktop = [FGX]::OnCurrentDesktop($target[0].H)
if ($desktop -ne 'yes' -and -not $AllowDesktopSwitch) {
    Write-Error "refusing to force-foreground '$Title': on-current-virtual-desktop=$desktop. Raising it would switch the operator's desktop. Pass -AllowDesktopSwitch if that is really what you want."
    exit 2
}
$raised = $false
foreach ($w in $target) { if ([FGX]::ForceForeground($w.H)) { $raised = $true } }
Write-Output "matched=$($target.Count) of $(@($wins).Count) title='$Title' mode=force desktop=$desktop unminimized=$restored foreground=$raised"
