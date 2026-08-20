// An NSIS plugin that puts a WebView2 inside the installer window, so the whole installer can be
// authored as a web page instead of as Win32 dialog resources.
//
// Why a plugin at all. electron-builder's installer is NSIS, and NSIS has to stay: electron-updater
// ships only an NsisUpdater for Windows, so the installer target is what the whole auto-update
// chain is built on. That leaves two ways to draw something that is not a 1990s wizard, and only
// one of them is any good:
//
//   - EmbedHTML, the plugin electron-builder already bundles, hosts MSHTML (verified: the window
//     chain is Shell Embedding -> Shell DocObject View -> Internet Explorer_Server). It works, and
//     it is what `Runtime` below falls back to advertising, but it is IE: no flexbox, no grid, no
//     CSS custom properties, and it renders one CSS pixel per device pixel regardless of DPI.
//   - WebView2 is Chromium, is DPI-aware on its own, and has a real two-way message channel. The
//     Evergreen runtime ships an x86 EmbeddedBrowserWebView.dll beside the x64 one, which is what
//     makes it reachable from here at all - NSIS stubs are always 32-bit.
//
// The runtime is not guaranteed on Windows 10, so nothing here may be load-bearing for *installing*.
// `Runtime` is the gate: the script asks first, and falls back to the stock MUI wizard when it comes
// back empty. Every other export is a no-op when creation failed rather than an error, so a
// half-created WebView can never wedge the install.
//
// Build: `node project/build/prepare-installer-webview.js` (pinned SDK, checksum, MSVC x86). The
// resulting NlWebView.dll is committed, for the same reason the installer bitmaps are:
// electron-builder resolves plugins while packing, and an asset missing at that moment is skipped
// with a log line rather than a failure.

#include <windows.h>
#include <objbase.h>
#include <shlwapi.h>
#include <commctrl.h>  // PBM_GETPOS / PBM_GETRANGE, for mirroring NSIS's own progress bar
// The umbrella header, not wrl/client.h + wrl/implements.h: `Callback`, which is what turns a
// lambda into one of WebView2's COM completion handlers, only comes in through wrl.h.
#include <wrl.h>

#include <deque>
#include <string>

#include "WebView2.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

// ---------------------------------------------------------------------------------------------
// NSIS plugin ABI.
//
// Hand-rolled rather than pulled from nsis/Contrib/ExDLL: it is thirty lines, and vendoring the
// SDK's headers for them would mean pinning a second upstream.

typedef struct _stack_t {
    struct _stack_t *next;
    wchar_t text[1]; // variable length, g_stringsize wide characters
} stack_t;

// Only the last member is ever touched; the leading ones are declared opaque so this does not have
// to track exec_flags_t across NSIS versions.
typedef struct {
    void *exec_flags;
    void *ExecuteCodeSegment;
    void *validate_filename;
    int(__stdcall *RegisterPluginCallback)(HMODULE, UINT_PTR(__cdecl *)(int));
} extra_parameters;

#define NSPIM_UNLOAD 0

static unsigned int g_stringsize = 0;
static stack_t **g_stacktop = nullptr;
static HMODULE g_module = nullptr;

static void nsis_init(int string_size, stack_t **stacktop) {
    g_stringsize = static_cast<unsigned int>(string_size);
    g_stacktop = stacktop;
}

static std::wstring pop_string() {
    if (g_stacktop == nullptr || *g_stacktop == nullptr) {
        return std::wstring();
    }
    stack_t *item = *g_stacktop;
    std::wstring value(item->text);
    *g_stacktop = item->next;
    GlobalFree(reinterpret_cast<HGLOBAL>(item));
    return value;
}

static void push_string(const wchar_t *value) {
    if (g_stacktop == nullptr) {
        return;
    }
    const size_t bytes = sizeof(stack_t) + static_cast<size_t>(g_stringsize) * sizeof(wchar_t);
    stack_t *item = static_cast<stack_t *>(GlobalAlloc(GPTR, bytes));
    if (item == nullptr) {
        return;
    }
    lstrcpynW(item->text, value, static_cast<int>(g_stringsize));
    item->next = *g_stacktop;
    *g_stacktop = item;
}

static int pop_int() {
    const std::wstring text = pop_string();
    return static_cast<int>(wcstol(text.c_str(), nullptr, 10));
}

// ---------------------------------------------------------------------------------------------
// Plugin state.
//
// NSIS unloads a plugin DLL after each call unless the plugin registers an unload callback, which
// is what `keep_loaded` does. Everything below has to survive between calls, because the WebView is
// created on one call, polled on hundreds, and torn down on another.

namespace {

enum class State {
    Idle,      // nothing asked for yet
    Creating,  // environment/controller requested, callbacks pending
    Ready,     // usable
    Failed,    // creation failed; every export degrades to a no-op
};

struct Host {
    State state = State::Idle;
    HWND parent = nullptr;      // the window the WebView fills
    HWND top = nullptr;         // top-level window, for the drag hand-off
    HRESULT error = S_OK;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
    std::deque<std::wstring> inbox;
    CRITICAL_SECTION lock;
    bool lock_ready = false;
    bool com_initialized = false;

    HWND tracked_bar = nullptr; // NSIS's own progress bar, mirrored into the page
    UINT_PTR tracker = 0;
    int last_permille = -1;
};

Host g_host;

void ensure_lock() {
    if (!g_host.lock_ready) {
        InitializeCriticalSection(&g_host.lock);
        g_host.lock_ready = true;
    }
}

// The page asks to move the window by posting "@drag" on mousedown. Handling it here rather than
// letting the script poll for it is not an optimisation: WM_NCLBUTTONDOWN only starts a real move
// loop while the physical button is still down, and a round trip through an NSIS timer is long
// enough to lose that race on a quick grab.
void begin_window_drag() {
    if (g_host.top == nullptr) {
        return;
    }
    ReleaseCapture();
    POINT cursor{};
    GetCursorPos(&cursor);
    SendMessageW(g_host.top, WM_NCLBUTTONDOWN, HTCAPTION, MAKELPARAM(cursor.x, cursor.y));
}

void fit_to_parent() {
    if (!g_host.controller || g_host.parent == nullptr) {
        return;
    }
    RECT bounds{};
    GetClientRect(g_host.parent, &bounds);
    g_host.controller->put_Bounds(bounds);
}

// The installer manifest declares system DPI awareness, so the window is scaled once at startup and
// never re-scaled. Letting the WebView track per-monitor changes on top of that would make the page
// disagree with the window it sits in the moment it crosses to a differently scaled display, so the
// rasterisation scale is pinned to the same system DPI the window was sized with.
void pin_rasterization_scale() {
    ComPtr<ICoreWebView2Controller3> controller3;
    if (FAILED(g_host.controller.As(&controller3))) {
        return;
    }
    const HDC screen = GetDC(nullptr);
    const int dpi = screen != nullptr ? GetDeviceCaps(screen, LOGPIXELSX) : 96;
    if (screen != nullptr) {
        ReleaseDC(nullptr, screen);
    }
    controller3->put_ShouldDetectMonitorScaleChanges(FALSE);
    controller3->put_RasterizationScale(static_cast<double>(dpi) / 96.0);
}

// A Chromium window inside an installer should not offer the browser's own affordances: there is no
// address bar to hide, and a right-click menu with "Save as..." on a wizard page is a bug report
// waiting to happen.
void lock_down_settings() {
    ComPtr<ICoreWebView2Settings> settings;
    if (FAILED(g_host.webview->get_Settings(&settings))) {
        return;
    }
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsWebMessageEnabled(TRUE);

    // Ctrl+P, F5, Ctrl+F and the rest arrived in ICoreWebView2Settings3. Queried rather than
    // required: an older runtime that predates it still gives a usable installer, just one where
    // F5 reloads the page.
    ComPtr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings.As(&settings3))) {
        settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
    }
}

// Painted before the document has anything to show. Without it the first frame is Chromium's white,
// which on a dark installer reads as a flash of the wrong application.
void set_background(COLORREF colour) {
    ComPtr<ICoreWebView2Controller2> controller2;
    if (FAILED(g_host.controller.As(&controller2))) {
        return;
    }
    COREWEBVIEW2_COLOR background{};
    background.A = 255;
    background.R = GetRValue(colour);
    background.G = GetGValue(colour);
    background.B = GetBValue(colour);
    controller2->put_DefaultBackgroundColor(background);
}

// Mirror NSIS's own progress bar into the page.
//
// The bar is real progress and not a guess because it is *NSIS's* number: the stub advances that
// control as it extracts, from totals it computed at build time. Reading it beats anything the
// script could report, which could only ever be "section 3 of 5".
//
// Polled from a timer rather than pushed from the script because during an install there is no
// script to push from - NSIS runs the section on its own thread while this one pumps messages, so
// a timer here keeps ticking exactly when the bar is moving and the script is busy.
void CALLBACK track_tick(HWND, UINT, UINT_PTR, DWORD) {
    if (g_host.state != State::Ready || !g_host.webview || g_host.tracked_bar == nullptr) {
        return;
    }
    if (!IsWindow(g_host.tracked_bar)) {
        return;
    }

    const LRESULT pos = SendMessageW(g_host.tracked_bar, PBM_GETPOS, 0, 0);
    const LRESULT high = SendMessageW(g_host.tracked_bar, PBM_GETRANGE, FALSE, 0);
    if (high <= 0) {
        return;
    }

    // Quantised to a tenth of a percent: the page animates the width anyway, and re-running a
    // script for a change nothing can see is the one cost this timer could actually impose.
    const int permille = static_cast<int>((static_cast<long long>(pos) * 1000) / high);
    if (permille == g_host.last_permille) {
        return;
    }
    g_host.last_permille = permille;

    wchar_t script[96];
    wsprintfW(script, L"window.nlProgress&&window.nlProgress(%d/1000)", permille);
    g_host.webview->ExecuteScript(script, nullptr);
}

void attach_message_handler() {
    EventRegistrationToken token{};
    g_host.webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                LPWSTR raw = nullptr;
                if (FAILED(args->TryGetWebMessageAsString(&raw)) || raw == nullptr) {
                    return S_OK;
                }
                const std::wstring message(raw);
                CoTaskMemFree(raw);

                // Messages beginning with "@" are answered here rather than queued, because the
                // script is not always in a position to answer them: during the install itself
                // NSIS is running a section on another thread and no page loop is polling. Pressing
                // the installer's own (hidden) buttons works from any page, which is what lets one
                // document drive the whole wizard.
                if (message == L"@drag") {
                    begin_window_drag();
                    return S_OK;
                }
                if (message == L"@next" && g_host.top != nullptr) {
                    PostMessageW(g_host.top, WM_COMMAND, IDOK, 0);
                    return S_OK;
                }
                if (message == L"@cancel" && g_host.top != nullptr) {
                    PostMessageW(g_host.top, WM_COMMAND, IDCANCEL, 0);
                    return S_OK;
                }

                ensure_lock();
                EnterCriticalSection(&g_host.lock);
                // A page that spins could otherwise grow this without bound while the script is
                // busy installing. Dropping the oldest is right for this traffic: every message is
                // a discrete user intent, and a stale one is worth less than the newest.
                if (g_host.inbox.size() >= 256) {
                    g_host.inbox.pop_front();
                }
                g_host.inbox.push_back(message);
                LeaveCriticalSection(&g_host.lock);
                return S_OK;
            })
            .Get(),
        &token);
}

} // namespace

// ---------------------------------------------------------------------------------------------

static UINT_PTR __cdecl plugin_callback(int message) {
    if (message == NSPIM_UNLOAD) {
        if (g_host.controller) {
            g_host.controller->Close();
        }
        g_host.controller.Reset();
        g_host.webview.Reset();
        if (g_host.com_initialized) {
            CoUninitialize();
            g_host.com_initialized = false;
        }
        if (g_host.lock_ready) {
            DeleteCriticalSection(&g_host.lock);
            g_host.lock_ready = false;
        }
    }
    return 0;
}

static void keep_loaded(extra_parameters *extra) {
    if (extra != nullptr && extra->RegisterPluginCallback != nullptr && g_module != nullptr) {
        extra->RegisterPluginCallback(g_module, plugin_callback);
    }
}

#define NSIS_EXPORT(name)                                                                     \
    extern "C" __declspec(dllexport) void __cdecl name(                                       \
        HWND hwndParent, int string_size, wchar_t *variables, stack_t **stacktop,             \
        extra_parameters *extra)

// Pushes the installed Evergreen runtime's version, or "" when there is none. This is the gate the
// script checks before committing to the custom UI.
NSIS_EXPORT(Runtime) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    LPWSTR version = nullptr;
    const HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    if (SUCCEEDED(hr) && version != nullptr) {
        push_string(version);
        CoTaskMemFree(version);
    } else {
        push_string(L"");
    }
}

// Create <parent hwnd> <user data folder> <url> <background rrggbb>
//
// Returns immediately; creation is asynchronous and completes while NSIS pumps messages for its own
// dialog. The script polls `Ready`.
NSIS_EXPORT(Create) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)variables;

    const HWND parent = reinterpret_cast<HWND>(static_cast<UINT_PTR>(pop_int()));
    const std::wstring data_folder = pop_string();
    const std::wstring url = pop_string();
    const std::wstring background = pop_string();

    if (parent == nullptr || !IsWindow(parent)) {
        g_host.state = State::Failed;
        g_host.error = E_INVALIDARG;
        return;
    }

    g_host.parent = parent;
    g_host.top = hwndParent != nullptr ? hwndParent : GetAncestor(parent, GA_ROOT);
    g_host.state = State::Creating;
    ensure_lock();

    // WebView2 wants an STA. NSIS's own thread is already initialised for OLE, so the expected
    // outcome here is S_FALSE; RPC_E_CHANGED_MODE would mean somebody put this thread in an MTA,
    // which WebView2 cannot use - recorded as a failure rather than pushed through.
    const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (com == RPC_E_CHANGED_MODE) {
        g_host.state = State::Failed;
        g_host.error = com;
        return;
    }
    g_host.com_initialized = SUCCEEDED(com);

    COLORREF colour = RGB(0x0b, 0x0d, 0x12);
    if (background.size() == 6) {
        const unsigned long packed = wcstoul(background.c_str(), nullptr, 16);
        colour = RGB((packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff);
    }

    const std::wstring page = url;

    const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, data_folder.empty() ? nullptr : data_folder.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [parent, page, colour](HRESULT result, ICoreWebView2Environment *environment) -> HRESULT {
                if (FAILED(result) || environment == nullptr) {
                    g_host.state = State::Failed;
                    g_host.error = result;
                    return S_OK;
                }
                return environment->CreateCoreWebView2Controller(
                    parent,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [page, colour](HRESULT inner, ICoreWebView2Controller *controller) -> HRESULT {
                            if (FAILED(inner) || controller == nullptr) {
                                g_host.state = State::Failed;
                                g_host.error = inner;
                                return S_OK;
                            }
                            g_host.controller = controller;
                            if (FAILED(controller->get_CoreWebView2(&g_host.webview))) {
                                g_host.state = State::Failed;
                                g_host.error = E_FAIL;
                                return S_OK;
                            }
                            set_background(colour);
                            pin_rasterization_scale();
                            lock_down_settings();
                            attach_message_handler();
                            fit_to_parent();
                            g_host.controller->put_IsVisible(TRUE);
                            if (!page.empty()) {
                                g_host.webview->Navigate(page.c_str());
                            }
                            g_host.state = State::Ready;
                            return S_OK;
                        })
                        .Get());
            })
            .Get());

    if (FAILED(hr)) {
        g_host.state = State::Failed;
        g_host.error = hr;
    }
}

// Pushes "1" once usable, "0" while still creating, "-1" if it failed for good.
NSIS_EXPORT(Ready) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    switch (g_host.state) {
    case State::Ready:
        push_string(L"1");
        break;
    case State::Failed:
        push_string(L"-1");
        break;
    default:
        push_string(L"0");
        break;
    }
}

// Eval <javascript> - one-way; results are reported back through the message channel like anything
// else the page has to say.
NSIS_EXPORT(Eval) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    const std::wstring script = pop_string();
    if (g_host.state != State::Ready || !g_host.webview) {
        return;
    }
    g_host.webview->ExecuteScript(script.c_str(), nullptr);
}

// Pops the oldest message the page posted, or "" when there is none.
NSIS_EXPORT(Poll) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    std::wstring message;
    ensure_lock();
    EnterCriticalSection(&g_host.lock);
    if (!g_host.inbox.empty()) {
        message = g_host.inbox.front();
        g_host.inbox.pop_front();
    }
    LeaveCriticalSection(&g_host.lock);
    push_string(message.c_str());
}

// Track <hwnd of NSIS's progress bar>
//
// Starts mirroring that bar into `window.nlProgress(fraction)`. An empty or zero handle stops it.
// A thread timer (no window) rather than one owned by the installer's window, so nothing here can
// outlive or interfere with a dialog NSIS is in the middle of destroying.
NSIS_EXPORT(Track) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    const HWND bar = reinterpret_cast<HWND>(static_cast<UINT_PTR>(pop_int()));

    if (g_host.tracker != 0) {
        KillTimer(nullptr, g_host.tracker);
        g_host.tracker = 0;
    }
    g_host.tracked_bar = (bar != nullptr && IsWindow(bar)) ? bar : nullptr;
    g_host.last_permille = -1;
    if (g_host.tracked_bar != nullptr) {
        g_host.tracker = SetTimer(nullptr, 0, 100, track_tick);
    }
}

// Re-fits the WebView to its parent. The script calls this after it resizes the window.
NSIS_EXPORT(Fit) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;
    fit_to_parent();
}

// Pushes the HRESULT of whatever went wrong, as hex. Diagnostics only - the script's decision is
// made on `Runtime` and `Ready`.
NSIS_EXPORT(LastError) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    wchar_t text[16];
    wsprintfW(text, L"0x%08X", g_host.error);
    push_string(text);
}

NSIS_EXPORT(Destroy) {
    nsis_init(string_size, stacktop);
    keep_loaded(extra);
    (void)hwndParent;
    (void)variables;

    if (g_host.controller) {
        g_host.controller->Close();
    }
    g_host.controller.Reset();
    g_host.webview.Reset();
    g_host.state = State::Idle;
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = module;
        DisableThreadLibraryCalls(module);
    }
    return TRUE;
}
