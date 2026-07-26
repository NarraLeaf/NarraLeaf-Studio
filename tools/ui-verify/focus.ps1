# Raise ONE window of the isolated instance and make it the ONLY topmost one of that process.
# Without this Electron reports document.hidden === true and every layout/timing read is fiction
# (handoff §6.8). Scoped by pid so it can never touch another session's Studio.
#
# Two Studio windows both pinned TOPMOST fight for z-order and SetForegroundWindow silently loses
# from a background process, so the other windows of the same pid are demoted first.
param([Parameter(Mandatory = $true)][string]$Title, [int]$ProcId = 0, [switch]$Off)

$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class FGX {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  /**
   * SetForegroundWindow from a background process is refused by the Windows foreground lock, which
   * is why a plain raise silently loses and Electron keeps reporting document.hidden === true.
   * Borrowing the current foreground thread's input queue lifts the lock for the duration.
   */
  public static void ForceForeground(IntPtr h) {
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint self = GetCurrentThreadId();
    AttachThreadInput(fgThread, self, true);
    ShowWindow(h, 9);
    SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x0003);
    SetForegroundWindow(h);
    AttachThreadInput(fgThread, self, false);
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

$NOTOPMOST = [IntPtr](-2)
$TOPMOST = [IntPtr](-1)
$FLAGS = 0x0003  # SWP_NOMOVE | SWP_NOSIZE

$wins = [FGX]::OfProcess([uint32]$ProcId) | Where-Object { $_.T -like 'NarraLeaf*' -or $_.T -eq 'Dev Mode' }
$target = $wins | Where-Object { $_.T -eq $Title }

foreach ($w in $wins) {
    if ($Off -or $w.T -ne $Title) { [FGX]::SetWindowPos($w.H, $NOTOPMOST, 0, 0, 0, 0, $FLAGS) | Out-Null }
}
if (-not $Off) {
    foreach ($w in $target) { [FGX]::ForceForeground($w.H) }
}
Write-Output "matched=$(@($target).Count) of $(@($wins).Count) title='$Title' topmost=$(-not $Off)"
