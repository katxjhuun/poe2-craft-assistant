// PoE2 Craft Assistant, desktop helper.
//
// A tray program that serves the Craft Assistant page from this folder on localhost, opens it in its own window, and
// while Path of Exile 2 is the window in front listens for one hotkey (default Ctrl+D). On the hotkey it presses the
// game's own "copy item" keys (Alt+Ctrl+C: the item text with modifier tiers) for the item under the cursor, reads the
// clipboard and hands the text to the page, which loads the item and checks its price. One key press, one copy: the
// same thing the player would do by hand. It reads nothing from the game but the clipboard text the game writes.
//
// Built with the C# compiler that ships with Windows (.NET Framework 4, C# 5): see build.cmd.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PoE2CraftAssistant
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool first;
            using (Mutex one = new Mutex(true, "PoE2CraftAssistant.single", out first))
            {
                if (!first) { MessageBox.Show("PoE2 Craft Assistant is already running (see the tray icon).", "PoE2 Craft Assistant"); return; }
                Application.EnableVisualStyles();
                Application.Run(new Host(args));
            }
        }
    }

    /// <summary>Settings, kept in config.json next to the program.</summary>
    class Config
    {
        public string Hotkey = "Ctrl+D";
        public int Port = 47652;
        public bool Topmost = true;        // keep the assistant's window above the game
        public bool AdvancedCopy = true;   // Alt+Ctrl+C (modifier tiers) instead of Ctrl+C
        public string GameTitle = "Path of Exile 2";
        public string File;

        public static Config Load(string file)
        {
            Config c = new Config();
            c.File = file;
            try
            {
                if (System.IO.File.Exists(file))
                {
                    Dictionary<string, object> d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(System.IO.File.ReadAllText(file));
                    if (d.ContainsKey("hotkey")) c.Hotkey = Convert.ToString(d["hotkey"]);
                    if (d.ContainsKey("port")) c.Port = Convert.ToInt32(d["port"]);
                    if (d.ContainsKey("topmost")) c.Topmost = Convert.ToBoolean(d["topmost"]);
                    if (d.ContainsKey("advancedCopy")) c.AdvancedCopy = Convert.ToBoolean(d["advancedCopy"]);
                    if (d.ContainsKey("gameTitle")) c.GameTitle = Convert.ToString(d["gameTitle"]);
                }
                else c.Save();
            }
            catch (Exception) { /* a broken file: the defaults */ }
            return c;
        }

        public void Save()
        {
            try
            {
                string json = "{\r\n  \"hotkey\": " + Json(Hotkey) + ",\r\n  \"port\": " + Port + ",\r\n  \"topmost\": " + (Topmost ? "true" : "false")
                    + ",\r\n  \"advancedCopy\": " + (AdvancedCopy ? "true" : "false") + ",\r\n  \"gameTitle\": " + Json(GameTitle) + "\r\n}\r\n";
                System.IO.File.WriteAllText(File, json);
            }
            catch (Exception) { /* read-only folder: the settings last until exit */ }
        }

        public static string Json(string s) { return new JavaScriptSerializer().Serialize(s); }
    }

    /// <summary>Serves the page and pushes copied items to it (server-sent events).</summary>
    class Server
    {
        readonly HttpListener listener = new HttpListener();
        readonly List<HttpListenerResponse> clients = new List<HttpListenerResponse>();
        readonly string root;
        readonly Config cfg;
        Thread thread;
        System.Threading.Timer ping;
        public string Url;

        public Server(string appDir, Config c)
        {
            root = Path.GetFullPath(appDir);
            cfg = c;
            Url = "http://localhost:" + c.Port + "/";
            listener.Prefixes.Add(Url);
        }

        public void Start()
        {
            listener.Start();
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Start();
            ping = new System.Threading.Timer(delegate { Send(": ping\n\n"); }, null, 15000, 15000);
        }

        public void Stop()
        {
            try { if (ping != null) ping.Dispose(); listener.Stop(); } catch (Exception) { }
        }

        public int Clients { get { lock (clients) return clients.Count; } }

        void Loop()
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); } catch (Exception) { break; }
                ThreadPool.QueueUserWorkItem(delegate(object o) { try { Handle((HttpListenerContext)o); } catch (Exception) { } }, ctx);
            }
        }

        void Handle(HttpListenerContext ctx)
        {
            HttpListenerRequest q = ctx.Request;
            HttpListenerResponse r = ctx.Response;
            string path = Uri.UnescapeDataString(q.Url.AbsolutePath);
            if (path == "/bridge")
            {
                Text(r, 200, "application/json", "{\"bridge\":true,\"hotkey\":" + Config.Json(cfg.Hotkey) + ",\"game\":" + Config.Json(cfg.GameTitle) + "}");
                return;
            }
            if (path == "/events")
            {
                r.StatusCode = 200;
                r.ContentType = "text/event-stream";
                r.Headers["Cache-Control"] = "no-cache";
                r.SendChunked = true;
                byte[] hello = Encoding.UTF8.GetBytes(": connected\n\n");
                r.OutputStream.Write(hello, 0, hello.Length);
                r.OutputStream.Flush();
                lock (clients) clients.Add(r);
                return; // kept open: items are written to it as they are copied
            }
            if (path == "/push" && q.HttpMethod == "POST")
            {
                // an item text from this machine (a test, or another tool); pages of other sites may not push
                string origin = q.Headers["Origin"];
                if (origin != null && origin.TrimEnd('/') != Url.TrimEnd('/')) { Text(r, 403, "text/plain", "forbidden"); return; }
                string body;
                using (StreamReader sr = new StreamReader(q.InputStream, Encoding.UTF8)) body = sr.ReadToEnd();
                Push(body, "push");
                Text(r, 200, "text/plain", "ok");
                return;
            }
            if (q.HttpMethod != "GET") { Text(r, 405, "text/plain", "method not allowed"); return; }
            if (path == "/") path = "/index.html";
            string file = Path.GetFullPath(Path.Combine(root, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
            if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) { Text(r, 404, "text/plain", "not found"); return; }
            byte[] data = File.ReadAllBytes(file);
            r.StatusCode = 200;
            r.ContentType = Mime(file);
            r.Headers["Cache-Control"] = "no-cache";
            r.ContentLength64 = data.Length;
            r.OutputStream.Write(data, 0, data.Length);
            r.OutputStream.Close();
        }

        static string Mime(string file)
        {
            switch (Path.GetExtension(file).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".webp": return "image/webp";
                case ".otf": return "font/otf";
                default: return "application/octet-stream";
            }
        }

        static void Text(HttpListenerResponse r, int code, string type, string body)
        {
            byte[] b = Encoding.UTF8.GetBytes(body);
            r.StatusCode = code;
            r.ContentType = type;
            r.Headers["Cache-Control"] = "no-store";
            r.ContentLength64 = b.Length;
            r.OutputStream.Write(b, 0, b.Length);
            r.OutputStream.Close();
        }

        /// <summary>An item text for the page. Returns the number of open pages it reached.</summary>
        public int Push(string text, string source)
        {
            Dictionary<string, object> m = new Dictionary<string, object>();
            m["text"] = text;
            m["source"] = source;
            m["at"] = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            return Send("data: " + new JavaScriptSerializer().Serialize(m) + "\n\n");
        }

        int Send(string frame)
        {
            byte[] b = Encoding.UTF8.GetBytes(frame);
            int ok = 0;
            lock (clients)
            {
                for (int i = clients.Count - 1; i >= 0; i--)
                {
                    try { clients[i].OutputStream.Write(b, 0, b.Length); clients[i].OutputStream.Flush(); ok++; }
                    catch (Exception) { try { clients[i].Abort(); } catch (Exception) { } clients.RemoveAt(i); }
                }
            }
            return ok;
        }
    }

    static class Native
    {
        public const int WM_HOTKEY = 0x0312;
        public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;
        public const ushort VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_C = 0x43;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1), HWND_NOTOPMOST = new IntPtr(-2);
        public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
        [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
        [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public InputUnion u; }

        public static INPUT Key(ushort vk, bool up)
        {
            INPUT i = new INPUT();
            i.type = 1; // keyboard
            i.u.ki.wVk = vk;
            i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
            i.u.ki.dwFlags = up ? 2u : 0u; // KEYEVENTF_KEYUP
            return i;
        }

        public static string TitleOf(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);

        /// <summary>
        /// The assistant's own window: a visible Edge window whose title is exactly the page's (an app-mode window has
        /// no browser suffix). Other windows that merely mention the name (a chat, a folder, a browser tab) do not count.
        /// </summary>
        public static IntPtr FindWindowByTitle(string title)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                if (!IsWindowVisible(h) || TitleOf(h) != title) return true;
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                try { if (!Process.GetProcessById((int)pid).ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase)) return true; }
                catch (Exception) { return true; }
                found = h;
                return false;
            }, IntPtr.Zero);
            return found;
        }
    }

    /// <summary>A hidden window that receives the hotkey.</summary>
    class HotkeyWindow : NativeWindow
    {
        public event EventHandler Pressed;
        public HotkeyWindow() { CreateHandle(new CreateParams()); }
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_HOTKEY && Pressed != null) Pressed(this, EventArgs.Empty);
            base.WndProc(ref m);
        }
    }

    class Host : ApplicationContext
    {
        const string PAGE_TITLE = "PoE2 Craft Assistant";
        readonly Config cfg;
        readonly Server server;
        readonly NotifyIcon tray;
        readonly HotkeyWindow win = new HotkeyWindow();
        readonly System.Windows.Forms.Timer focus = new System.Windows.Forms.Timer();
        readonly bool anyWindow, noWindow;
        readonly string dir;
        bool registered;
        uint mods, vk;
        MenuItem topItem, keyItem;

        public Host(string[] args)
        {
            dir = Path.GetDirectoryName(Application.ExecutablePath);
            anyWindow = Array.IndexOf(args, "--any-window") >= 0; // the hotkey also outside the game (for trying it out)
            noWindow = Array.IndexOf(args, "--no-window") >= 0;   // do not open the assistant's window
            cfg = Config.Load(Path.Combine(dir, "config.json"));

            tray = new NotifyIcon();
            tray.Icon = MakeIcon();
            tray.Text = PAGE_TITLE;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenWindow(true); };
            BuildMenu();

            server = new Server(Path.Combine(dir, "app"), cfg);
            try { server.Start(); }
            catch (Exception e)
            {
                MessageBox.Show("The page could not be served on " + server.Url + " (" + e.Message + ").\nAnother program may use the port; change \"port\" in config.json.", PAGE_TITLE);
                Quit();
                return;
            }

            if (!ParseHotkey(cfg.Hotkey, out mods, out vk))
                tray.ShowBalloonTip(6000, PAGE_TITLE, "The hotkey \"" + cfg.Hotkey + "\" in config.json is not understood. Examples: Ctrl+D, F4, Alt+Q.", ToolTipIcon.Warning);
            win.Pressed += delegate { OnHotkey(); };
            focus.Interval = 400;
            focus.Tick += delegate { WatchFocus(); };
            focus.Start();

            if (!noWindow) OpenWindow(true);
        }

        void BuildMenu()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Open Craft Assistant", delegate { OpenWindow(true); });
            topItem = new MenuItem("Keep above the game", delegate
            {
                cfg.Topmost = !cfg.Topmost; cfg.Save(); topItem.Checked = cfg.Topmost;
                IntPtr h = Native.FindWindowByTitle(PAGE_TITLE);
                if (h != IntPtr.Zero) Native.SetWindowPos(h, cfg.Topmost ? Native.HWND_TOPMOST : Native.HWND_NOTOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            });
            topItem.Checked = cfg.Topmost;
            menu.MenuItems.Add(topItem);
            keyItem = new MenuItem("Hotkey: " + cfg.Hotkey + " (edit config.json)", delegate { try { Process.Start("notepad.exe", "\"" + cfg.File + "\""); } catch (Exception) { } });
            menu.MenuItems.Add(keyItem);
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Exit", delegate { Quit(); });
            tray.ContextMenu = menu;
        }

        static Icon MakeIcon()
        {
            using (Bitmap b = new Bitmap(32, 32))
            {
                using (Graphics g = Graphics.FromImage(b))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (Brush bg = new SolidBrush(Color.FromArgb(15, 15, 18))) g.FillEllipse(bg, 1, 1, 30, 30);
                    using (Pen ring = new Pen(Color.FromArgb(237, 178, 60), 3)) g.DrawEllipse(ring, 3, 3, 26, 26);
                    using (Brush dot = new SolidBrush(Color.FromArgb(237, 178, 60))) g.FillEllipse(dot, 11, 11, 10, 10);
                }
                return Icon.FromHandle(b.GetHicon());
            }
        }

        /// <summary>"Ctrl+D", "F4", "Alt+Shift+Q" -> RegisterHotKey modifiers and virtual key.</summary>
        static bool ParseHotkey(string text, out uint m, out uint key)
        {
            m = 0; key = 0;
            foreach (string raw in (text ?? "").Split('+'))
            {
                string p = raw.Trim();
                if (p.Length == 0) continue;
                string low = p.ToLowerInvariant();
                if (low == "ctrl" || low == "control") m |= Native.MOD_CONTROL;
                else if (low == "alt") m |= Native.MOD_ALT;
                else if (low == "shift") m |= Native.MOD_SHIFT;
                else if (low == "win") m |= Native.MOD_WIN;
                else
                {
                    Keys k;
                    string name = p.Length == 1 && char.IsDigit(p[0]) ? "D" + p : p;
                    if (!Enum.TryParse<Keys>(name, true, out k)) return false;
                    key = (uint)k;
                }
            }
            return key != 0;
        }

        /// <summary>The hotkey is taken only while the game is in front, so it keeps its usual meaning elsewhere.</summary>
        void WatchFocus()
        {
            if (vk == 0) return;
            bool game = anyWindow || Native.TitleOf(Native.GetForegroundWindow()).StartsWith(cfg.GameTitle, StringComparison.OrdinalIgnoreCase);
            if (game && !registered)
            {
                registered = Native.RegisterHotKey(win.Handle, 1, mods | Native.MOD_NOREPEAT, vk);
                if (!registered && keyItem.Tag == null)
                {
                    keyItem.Tag = "warned";
                    tray.ShowBalloonTip(6000, PAGE_TITLE, "The hotkey " + cfg.Hotkey + " is taken by another program. Close that program or change \"hotkey\" in config.json.", ToolTipIcon.Warning);
                }
            }
            else if (!game && registered) { Native.UnregisterHotKey(win.Handle, 1); registered = false; }
        }

        /// <summary>Copy the item under the cursor the way the player would (the game's own keys) and hand it to the page.</summary>
        void OnHotkey()
        {
            string before = null;
            try { if (Clipboard.ContainsText()) before = Clipboard.GetText(); Clipboard.Clear(); } catch (Exception) { }

            List<Native.INPUT> keys = new List<Native.INPUT>();
            bool hasCtrl = (mods & Native.MOD_CONTROL) != 0, hasAlt = (mods & Native.MOD_ALT) != 0, hasShift = (mods & Native.MOD_SHIFT) != 0;
            bool needAlt = cfg.AdvancedCopy && !hasAlt;
            if (hasShift) keys.Add(Native.Key(Native.VK_SHIFT, true)); // Shift would change the game's key
            if (!hasCtrl) keys.Add(Native.Key(Native.VK_CONTROL, false));
            if (needAlt) keys.Add(Native.Key(Native.VK_MENU, false));
            keys.Add(Native.Key(Native.VK_C, false));
            keys.Add(Native.Key(Native.VK_C, true));
            if (needAlt) keys.Add(Native.Key(Native.VK_MENU, true));
            if (!hasCtrl) keys.Add(Native.Key(Native.VK_CONTROL, true));
            Native.SendInput((uint)keys.Count, keys.ToArray(), Marshal.SizeOf(typeof(Native.INPUT)));

            string text = null;
            for (int i = 0; i < 25 && text == null; i++) // the game writes the clipboard within a few frames
            {
                Thread.Sleep(20);
                try { if (Clipboard.ContainsText()) text = Clipboard.GetText(); } catch (Exception) { }
            }
            if (text == null || text.IndexOf("Rarity:", StringComparison.Ordinal) < 0)
            {
                // nothing under the cursor (or not an item): the clipboard as it was
                try { if (text == null && before != null) Clipboard.SetText(before); } catch (Exception) { }
                return;
            }
            int reached = server.Push(text, "hotkey");
            if (reached == 0) OpenWindow(false); // the window was closed: open it, the page takes the item on the next press
            else ShowAbove();
        }

        /// <summary>The assistant's window above the game without taking the keyboard from it.</summary>
        void ShowAbove()
        {
            if (!cfg.Topmost) return;
            IntPtr h = Native.FindWindowByTitle(PAGE_TITLE);
            if (h == IntPtr.Zero) return;
            if (Native.IsIconic(h)) Native.ShowWindow(h, 4); // SW_SHOWNOACTIVATE
            Native.SetWindowPos(h, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
        }

        void OpenWindow(bool activate)
        {
            IntPtr h = Native.FindWindowByTitle(PAGE_TITLE);
            if (h != IntPtr.Zero)
            {
                if (Native.IsIconic(h)) Native.ShowWindow(h, 9); // SW_RESTORE
                if (cfg.Topmost) Native.SetWindowPos(h, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                if (activate) Native.SetForegroundWindow(h);
                return;
            }
            // its own window (Edge's app mode, on every Windows 10 and 11), with its own profile so the page keeps its data
            string edge = null;
            foreach (string p in new string[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles") })
            {
                if (p == null) continue;
                string f = Path.Combine(p, @"Microsoft\Edge\Application\msedge.exe");
                if (File.Exists(f)) { edge = f; break; }
            }
            try
            {
                if (edge != null)
                {
                    string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"PoE2CraftAssistant\window");
                    Process.Start(edge, "--app=" + server.Url + " --user-data-dir=\"" + profile + "\" --window-size=560,960 --no-first-run --no-default-browser-check");
                }
                else Process.Start(server.Url); // the default browser
            }
            catch (Exception e) { tray.ShowBalloonTip(6000, PAGE_TITLE, "The window could not be opened (" + e.Message + "). Open " + server.Url + " in a browser.", ToolTipIcon.Warning); }
            if (cfg.Topmost)
            {
                // once the window is there, keep it above the game
                System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
                int tries = 0;
                t.Interval = 500;
                t.Tick += delegate
                {
                    IntPtr w = Native.FindWindowByTitle(PAGE_TITLE);
                    if (w != IntPtr.Zero) Native.SetWindowPos(w, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                    if (w != IntPtr.Zero || ++tries > 20) { t.Stop(); t.Dispose(); }
                };
                t.Start();
            }
        }

        void Quit()
        {
            try { focus.Stop(); if (registered) Native.UnregisterHotKey(win.Handle, 1); } catch (Exception) { }
            // the window goes with the program: without it the page has nothing to load from
            try { IntPtr h = Native.FindWindowByTitle(PAGE_TITLE); if (h != IntPtr.Zero) Native.PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); } catch (Exception) { }
            if (server != null) server.Stop();
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }
    }
}
