// R Project Multicam AI for macOS: the native app. A Cocoa window with a WebKit view shows the app UI served by the
// bundled engine (Contents/Resources/app, run with the bundled Node.js and FFmpeg in Contents/Resources/runtime).
// The engine starts with the app and stops with it. Built by .github/workflows/app-release.yml (swiftc on macOS).
import Cocoa
import WebKit

let appName = "R Project Multicam AI"

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var engine: Process?
    var engineURL: URL?
    let res = Bundle.main.resourceURL!
    let fm = FileManager.default
    lazy var support = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/RProjectMulticam")
    lazy var logURL = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/\(appName).log")

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 840),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = appName
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .windowBackgroundColor
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 1000, height: 640)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("RProjectMulticamAIMain")
        web.loadHTMLString(startingPage, baseURL: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startEngine()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ note: Notification) { engine?.terminate() }

    // ------------------------------------------------------------------ engine
    func startEngine() {
        let runtime = res.appendingPathComponent("runtime")
        // A downloaded app carries the quarantine flag; its own helpers must run.
        let x = Process(); x.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        x.arguments = ["-dr", "com.apple.quarantine", runtime.path]; try? x.run(); x.waitUntilExit()

        try? fm.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !fm.fileExists(atPath: logURL.path) { fm.createFile(atPath: logURL.path, contents: nil) }
        let log = try? FileHandle(forWritingTo: logURL); log?.seekToEndOfFile()
        log?.write("\n=== \(Date()) · \(appName) \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "")\n".data(using: .utf8)!)

        let urlFile = fm.temporaryDirectory.appendingPathComponent("rpmulticam-\(getpid()).url")
        try? fm.removeItem(at: urlFile)
        let p = Process()
        p.executableURL = runtime.appendingPathComponent("node")
        p.arguments = [res.appendingPathComponent("app/rp-finalcut-engine.js").path, "--no-browser", "--url-file", urlFile.path, "--parent-pid", String(getpid())]
        var env = ProcessInfo.processInfo.environment
        env["RP_FFMPEG"] = runtime.appendingPathComponent("ffmpeg").path
        p.environment = env
        if let log = log { p.standardOutput = log; p.standardError = log }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { if self?.engineURL == nil { self?.engineFailed("The engine stopped while starting (code \(proc.terminationStatus)).") } }
        }
        do { try p.run() } catch { engineFailed("The engine could not start: \(error.localizedDescription)"); return }
        engine = p

        var tries = 0
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] t in
            guard let self = self else { t.invalidate(); return }
            tries += 1
            if let s = try? String(contentsOf: urlFile, encoding: .utf8), let u = URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)), !s.isEmpty {
                t.invalidate(); try? self.fm.removeItem(at: urlFile)
                self.engineURL = u
                self.web.load(URLRequest(url: u))
            } else if tries > 150 {
                t.invalidate(); self.engineFailed("The engine did not answer in time.")
            }
        }
    }

    func engineFailed(_ why: String) {
        let a = NSAlert()
        a.messageText = "\(appName) could not start"
        a.informativeText = why + "\n\nDetails are in ~/Library/Logs/\(appName).log. Please send that file to R Project support."
        a.addButton(withTitle: "Show Log"); a.addButton(withTitle: "Quit")
        if a.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.activateFileViewerSelecting([logURL]) }
        NSApp.terminate(nil)
    }

    // ------------------------------------------------------------------ web view: files, links, dialogs
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }
    // window.open / target=_blank: open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { NSWorkspace.shared.open(u) }
        return nil
    }
    // Only the engine's own page loads inside the app; every other link opens in the browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, let host = u.host, host != "127.0.0.1", host != "localhost" {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }
    // CI smoke test: RP_SNAPSHOT=<file.png> saves a picture of the window once the app page has loaded, then quits.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard engineURL != nil, let out = ProcessInfo.processInfo.environment["RP_SNAPSHOT"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            webView.takeSnapshot(with: nil) { img, _ in
                if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: out))
                }
                NSApp.terminate(nil)
            }
        }
    }

    // ------------------------------------------------------------------ menus
    func buildMenu() {
        let bar = NSMenu()
        let appItem = NSMenuItem(); bar.addItem(appItem)
        let m = NSMenu(title: appName)
        m.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "Show Log", action: #selector(showLog), keyEquivalent: "")
        m.addItem(withTitle: "Uninstall \(appName)…", action: #selector(uninstall), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = m.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        m.addItem(.separator())
        m.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = m

        let editItem = NSMenuItem(); bar.addItem(editItem)
        let e = NSMenu(title: "Edit")
        e.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        e.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        e.addItem(.separator())
        e.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        e.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        e.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        e.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = e

        let viewItem = NSMenuItem(); bar.addItem(viewItem)
        let v = NSMenu(title: "View")
        v.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        v.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = v

        let winItem = NSMenuItem(); bar.addItem(winItem)
        let w = NSMenu(title: "Window")
        w.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        w.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        w.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = w
        NSApp.windowsMenu = w
        NSApp.mainMenu = bar
    }

    @objc func reload() { if let u = engineURL { web.load(URLRequest(url: u)) } }
    @objc func showLog() { NSWorkspace.shared.activateFileViewerSelecting([logURL]) }

    @objc func uninstall() {
        let a = NSAlert()
        a.messageText = "Uninstall \(appName)?"
        a.informativeText = "The app, its settings and its sign-in on this Mac are removed. Your edits in Movies › R Project Multicam stay."
        a.addButton(withTitle: "Uninstall"); a.addButton(withTitle: "Cancel")
        a.alertStyle = .warning
        guard a.runModal() == .alertFirstButtonReturn else { return }
        engine?.terminate()
        try? fm.removeItem(at: support.appendingPathComponent("finalcut"))
        try? fm.removeItem(at: logURL)
        NSWorkspace.shared.recycle([Bundle.main.bundleURL]) { _, _ in DispatchQueue.main.async { NSApp.terminate(nil) } }
    }
}

let startingPage = """
<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark}html,body{height:100%;margin:0}body{display:grid;place-items:center;font:13px -apple-system,sans-serif;color:#8e8e93;background:transparent}
.s{width:18px;height:18px;margin:0 auto 10px;border-radius:50%;border:2px solid #8e8e9344;border-top-color:#0a84ff;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
</style></head><body><div><div class="s"></div>Starting…</div></body></html>
"""

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
