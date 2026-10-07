// PoE2 Craft Assistant, desktop helper.
//
// A tray program that serves the Craft Assistant page from this folder on localhost, opens it in its own window, and
// while Path of Exile 2 is the window in front listens for one hotkey (default Alt+D). On the hotkey it presses the
// game's own "copy item" keys (Alt+Ctrl+C: the item text with modifier tiers) for the item under the cursor, reads the
// clipboard and hands the text to the page, which loads the item (or, with a route running, takes it as the result
// of the route's next step). One key press, one copy: the same thing the player would do by hand. It reads nothing
// from the game but the clipboard text the game writes, and asks nothing of any web site.
//
// When the player picks a route in the page, the page sends that route's steps (POST /steps) and the program draws them
// over the game in a small panel of its own: no frame, never the keyboard, every click goes through to the game. It is
// shown while the game (or the assistant's window, with the game behind it) is the window in front.
//
// Built with the C# compiler that ships with Windows (.NET Framework 4, C# 5): see build.cmd.
using System;
using System.Collections.Generic;
using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
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
            Native.SetProcessDPIAware(); // the steps panel is drawn in real pixels (sharp text on a scaled screen)
            // --render-steps steps.json out.png [scale]: the steps panel drawn into a picture, nothing else (to check its look)
            int ri = Array.IndexOf(args, "--render-steps");
            if (ri >= 0 && args.Length > ri + 2)
            {
                StepsOverlay.RenderToFile(File.ReadAllText(args[ri + 1]), args[ri + 2], args.Length > ri + 3 ? float.Parse(args[ri + 3], CultureInfo.InvariantCulture) : 1f);
                return;
            }
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
        public string Hotkey = "Alt+D";
        public int Port = 47652;
        public bool Topmost = true;        // keep the assistant's window above the game
        public bool AdvancedCopy = true;   // Alt+Ctrl+C (modifier tiers) instead of Ctrl+C
        public bool WatchClipboard = true; // take every item copied in game (Ctrl+C, another tool's copy)
        public string GameTitle = "Path of Exile 2";
        public bool StepsOverlay = true;   // the chosen route's steps over the game
        public double StepsX = 50, StepsY = 3; // where: the panel's middle and its top, in percent of the game's width and height
        public int StepsScale = 100, StepsOpacity = 90; // percent; at 100 the panel is 380 pixels wide on a 1080 pixels high game
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
                    if (d.ContainsKey("watchClipboard")) c.WatchClipboard = Convert.ToBoolean(d["watchClipboard"]);
                    if (d.ContainsKey("stepsOverlay")) c.StepsOverlay = Convert.ToBoolean(d["stepsOverlay"]);
                    if (d.ContainsKey("stepsX")) c.StepsX = Math.Max(0, Math.Min(100, Convert.ToDouble(d["stepsX"], CultureInfo.InvariantCulture)));
                    if (d.ContainsKey("stepsY")) c.StepsY = Math.Max(0, Math.Min(100, Convert.ToDouble(d["stepsY"], CultureInfo.InvariantCulture)));
                    if (d.ContainsKey("stepsScale")) c.StepsScale = Math.Max(60, Math.Min(250, Convert.ToInt32(d["stepsScale"])));
                    if (d.ContainsKey("stepsOpacity")) c.StepsOpacity = Math.Max(30, Math.Min(100, Convert.ToInt32(d["stepsOpacity"])));
                    if (!d.ContainsKey("stepsOverlay")) c.Save(); // a file from before the steps panel: its settings are added
                    // settings of the price check, which the program no longer has: the file is written without them
                    if (d.ContainsKey("priceCheck") || d.ContainsKey("overlay")) c.Save();
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
                    + ",\r\n  \"advancedCopy\": " + (AdvancedCopy ? "true" : "false") + ",\r\n  \"gameTitle\": " + Json(GameTitle)
                    + ",\r\n  \"watchClipboard\": " + (WatchClipboard ? "true" : "false")
                    + ",\r\n  \"stepsOverlay\": " + (StepsOverlay ? "true" : "false")
                    + ",\r\n  \"stepsX\": " + StepsX.ToString("0.#", CultureInfo.InvariantCulture) + ",\r\n  \"stepsY\": " + StepsY.ToString("0.#", CultureInfo.InvariantCulture)
                    + ",\r\n  \"stepsScale\": " + StepsScale + ",\r\n  \"stepsOpacity\": " + StepsOpacity + "\r\n}\r\n";
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
        string lastJson = "{}";
        // what the page asked to be drawn over the game (null: nothing), and a counter that tells the window of a change
        public volatile string StepsJson;
        public volatile int StepsVersion;
        public volatile string OverlayState = "\"visible\":false"; // for GET /steps: is the panel shown, and where
        public volatile int MoveAsk; // counts the page's "Move" clicks: each starts or ends the moving of the panel

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
                Text(r, 200, "application/json", "{\"bridge\":true,\"hotkey\":" + Config.Json(cfg.Hotkey) + ",\"game\":" + Config.Json(cfg.GameTitle) + ",\"steps\":true}");
                return;
            }
            if (path == "/steps/move" && q.HttpMethod == "POST")
            {
                string origin = q.Headers["Origin"];
                if (origin != null && origin.TrimEnd('/') != Url.TrimEnd('/')) { Text(r, 403, "text/plain", "forbidden"); return; }
                lock (clients) MoveAsk = MoveAsk + 1;
                Text(r, 200, "application/json", "{\"ok\":true}");
                return;
            }
            if (path == "/steps")
            {
                if (q.HttpMethod == "POST")
                {
                    // the chosen route's steps, from the assistant's own page only; the answer says whether they are drawn
                    string origin = q.Headers["Origin"];
                    if (origin != null && origin.TrimEnd('/') != Url.TrimEnd('/')) { Text(r, 403, "text/plain", "forbidden"); return; }
                    if (q.ContentLength64 > 65536) { Text(r, 413, "text/plain", "too large"); return; }
                    string body;
                    using (StreamReader sr = new StreamReader(q.InputStream, Encoding.UTF8)) body = sr.ReadToEnd();
                    if (body.Length > 65536) { Text(r, 413, "text/plain", "too large"); return; }
                    try { new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(body); }
                    catch (Exception) { Text(r, 400, "text/plain", "not JSON"); return; }
                    lock (clients) { StepsJson = body; StepsVersion = StepsVersion + 1; }
                    Text(r, 200, "application/json", "{\"overlay\":" + (cfg.StepsOverlay ? "true" : "false") + "}");
                    return;
                }
                Text(r, 200, "application/json", "{\"overlay\":" + (cfg.StepsOverlay ? "true" : "false") + "," + OverlayState + ",\"clients\":" + Clients + ",\"steps\":" + (StepsJson ?? "null") + "}");
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
            if (path == "/last") { Text(r, 200, "application/json", lastJson); return; } // the item copied last (a window opened after it)
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
            lastJson = new JavaScriptSerializer().Serialize(m);
            return Send("data: " + lastJson + "\n\n");
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
        public const int WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_NOACTIVATE = 0x08000000;
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
        [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint key, byte alpha, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);

        public static string ClassOf(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(128);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

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
        [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
        public const int WM_CLIPBOARDUPDATE = 0x031D;
        [DllImport("user32.dll")] public static extern bool AddClipboardFormatListener(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool RemoveClipboardFormatListener(IntPtr hWnd);

        /// <summary>The visible, titled top-level windows of a process.</summary>
        public static List<IntPtr> WindowsOf(uint pid)
        {
            List<IntPtr> list = new List<IntPtr>();
            EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                uint p;
                GetWindowThreadProcessId(h, out p);
                if (p == pid && IsWindowVisible(h) && TitleOf(h).Length > 0) list.Add(h);
                return true;
            }, IntPtr.Zero);
            return list;
        }
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
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
        public event EventHandler ClipboardChanged;
        public HotkeyWindow() { CreateHandle(new CreateParams()); }
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_HOTKEY && Pressed != null) Pressed(this, EventArgs.Empty);
            if (m.Msg == Native.WM_CLIPBOARDUPDATE && ClipboardChanged != null) ClipboardChanged(this, EventArgs.Empty);
            base.WndProc(ref m);
        }
    }

    /// <summary>
    /// The chosen route's steps, drawn over the game: a small panel without a frame that never takes the keyboard and
    /// lets every click through to the game. The page says what to show (POST /steps); this only draws it. While it is
    /// being moved (tray menu) it takes the mouse: drag to place it, right-click when done.
    /// </summary>
    class StepsOverlay : Form
    {
        class Row { public string Text = "", Uses = ""; public bool Now; }
        const int MAX_ROWS = 12;
        static readonly Color BG = Color.FromArgb(15, 15, 18), LINE = Color.FromArgb(74, 66, 46), ACCENT = Color.FromArgb(237, 178, 60),
            TEXT = Color.FromArgb(238, 233, 222), DIM = Color.FromArgb(198, 192, 180), MUTED = Color.FromArgb(150, 145, 134),
            OK = Color.FromArgb(111, 181, 138), BAD = Color.FromArgb(232, 112, 98), NOWBG = Color.FromArgb(48, 39, 19);

        readonly List<Row> rows = new List<Row>();
        string title = "", sub = "", foot = "", msg = "", msgKind = "", nowText = "", nowHelp = "", nowWarn = "";
        bool has, moving, dragging;
        Point grab;
        float scale;
        byte alpha = 230;
        int height = -1; // of the panel as last measured (-1: measure again)
        Font fTitle, fRow, fNow, fSmall;
        /// <summary>The panel was dragged to a new place; the player ended the move (right-click).</summary>
        public event EventHandler Dropped, MoveEnded;

        public StepsOverlay()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = BG;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            SetScale(1f);
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_TOPMOST | Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.SetLayeredWindowAttributes(Handle, 0, alpha, 2); // LWA_ALPHA: the whole panel a little see-through
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0021) { m.Result = (IntPtr)3; return; } // WM_MOUSEACTIVATE: a click never makes it the window in front
            base.WndProc(ref m);
        }

        public bool HasSteps { get { return has; } }
        public bool Dragging { get { return dragging; } }
        public int PanelWidth { get { return S(380); } }

        public int PanelHeight
        {
            get
            {
                if (height < 0)
                    using (Bitmap b = new Bitmap(1, 1))
                    using (Graphics g = Graphics.FromImage(b)) height = Draw(g, PanelWidth, false);
                return height;
            }
        }

        public void SetOpacity(int percent)
        {
            alpha = (byte)Math.Max(60, Math.Min(255, percent * 255 / 100));
            if (IsHandleCreated) Native.SetLayeredWindowAttributes(Handle, 0, alpha, 2);
        }

        /// <summary>Screen scale times the player's own (config.json, stepsScale).</summary>
        public void SetScale(float s)
        {
            if (fRow != null && Math.Abs(s - scale) < 0.001f) return;
            scale = s;
            foreach (Font f in new Font[] { fTitle, fRow, fNow, fSmall }) if (f != null) f.Dispose();
            fTitle = new Font("Segoe UI", 11.5f * s, FontStyle.Bold, GraphicsUnit.Pixel);
            fRow = new Font("Segoe UI", 14f * s, FontStyle.Regular, GraphicsUnit.Pixel);
            fNow = new Font("Segoe UI", 14f * s, FontStyle.Bold, GraphicsUnit.Pixel);
            fSmall = new Font("Segoe UI", 12.5f * s, FontStyle.Regular, GraphicsUnit.Pixel);
            height = -1;
            Invalidate();
        }

        /// <summary>While moving, the panel takes the mouse; otherwise every click goes through it to the game.</summary>
        public bool Moving
        {
            get { return moving; }
            set
            {
                moving = value; dragging = false; height = -1;
                int ex = Native.GetWindowLong(Handle, -20);
                Native.SetWindowLong(Handle, -20, value ? ex & ~Native.WS_EX_TRANSPARENT : ex | Native.WS_EX_TRANSPARENT);
                Cursor = value ? Cursors.SizeAll : Cursors.Default;
                Invalidate();
            }
        }

        static string Str(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return "";
            string s = Convert.ToString(d[key], CultureInfo.InvariantCulture);
            StringBuilder sb = new StringBuilder(Math.Min(s.Length, 400));
            foreach (char c in s) { if (sb.Length >= 400) break; sb.Append(char.IsControl(c) ? ' ' : c); }
            return sb.ToString().Trim();
        }

        /// <summary>
        /// What the page sent: {show, title, sub, rows: [{t, u, now}], now: {t, help, warn}, msg: {t, kind}, foot}.
        /// Anything else (or show: false) empties the panel.
        /// </summary>
        public void SetSteps(string json)
        {
            rows.Clear();
            title = sub = foot = msg = msgKind = nowText = nowHelp = nowWarn = "";
            has = false;
            try
            {
                Dictionary<string, object> d = json == null ? null : new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                if (d != null && d.ContainsKey("show") && d["show"] is bool && (bool)d["show"])
                {
                    title = Str(d, "title"); sub = Str(d, "sub"); foot = Str(d, "foot");
                    Dictionary<string, object> m = d.ContainsKey("msg") ? d["msg"] as Dictionary<string, object> : null;
                    if (m != null) { msg = Str(m, "t"); msgKind = Str(m, "kind"); }
                    Dictionary<string, object> n = d.ContainsKey("now") ? d["now"] as Dictionary<string, object> : null;
                    if (n != null) { nowText = Str(n, "t"); nowHelp = Str(n, "help"); nowWarn = Str(n, "warn"); }
                    IEnumerable list = d.ContainsKey("rows") && !(d["rows"] is string) ? d["rows"] as IEnumerable : null;
                    if (list != null)
                        foreach (object o in list)
                        {
                            Dictionary<string, object> r = o as Dictionary<string, object>;
                            if (r == null || rows.Count >= 40) continue;
                            Row row = new Row();
                            row.Text = Str(r, "t"); row.Uses = Str(r, "u");
                            row.Now = r.ContainsKey("now") && r["now"] is bool && (bool)r["now"];
                            if (row.Text.Length > 0) rows.Add(row);
                        }
                    has = title.Length > 0 || rows.Count > 0 || msg.Length > 0 || nowText.Length > 0;
                }
            }
            catch (Exception) { rows.Clear(); has = false; }
            height = -1;
            Invalidate();
        }

        int S(float v) { return (int)Math.Round(v * scale); }

        static StringFormat Fmt(StringAlignment a)
        {
            StringFormat f = new StringFormat(StringFormat.GenericTypographic);
            f.Alignment = a;
            f.Trimming = StringTrimming.EllipsisWord;
            return f;
        }

        static int HeightOf(Graphics g, string text, Font f, float w, StringFormat sf)
        {
            if (text.Length == 0 || w < 1) return 0;
            return (int)Math.Ceiling(g.MeasureString(text, f, new SizeF(w, 4000f), sf).Height);
        }

        static float WidthOf(Graphics g, string text, Font f, StringFormat sf)
        {
            return text.Length == 0 ? 0 : (float)Math.Ceiling(g.MeasureString(text, f, new SizeF(4000f, 4000f), sf).Width);
        }

        /// <summary>A text in a column: drawn when painting, its height either way.</summary>
        static int Put(Graphics g, bool paint, string text, Font f, Color c, float x, float y, float w, StringFormat sf)
        {
            int h = HeightOf(g, text, f, w, sf);
            if (paint && h > 0) using (SolidBrush b = new SolidBrush(c)) g.DrawString(text, f, b, new RectangleF(x, y, w, h + 1), sf);
            return h;
        }

        /// <summary>One step: its number, its materials, its uses; the step to use now also what it does and its warning.</summary>
        int Block(Graphics g, bool paint, string num, string text, string uses, bool now, int y, int W, float numW, float nameW, float usesW, StringFormat left, StringFormat right)
        {
            int pad = S(12), vp = S(now ? 5 : 3);
            float wide = nameW + usesW;
            int h = HeightOf(g, text, now ? fNow : fRow, nameW, left);
            int hHelp = now ? HeightOf(g, nowHelp, fSmall, wide, left) : 0, hWarn = now ? HeightOf(g, nowWarn, fSmall, wide, left) : 0;
            int total = vp + h + (hHelp > 0 ? S(2) + hHelp : 0) + (hWarn > 0 ? S(2) + hWarn : 0) + vp;
            if (paint && now)
            {
                using (SolidBrush b = new SolidBrush(NOWBG)) g.FillRectangle(b, pad - S(7), y, W - 2 * pad + S(14), total);
                using (SolidBrush b = new SolidBrush(ACCENT)) g.FillRectangle(b, pad - S(7), y, S(3), total);
            }
            int ty = y + vp;
            Put(g, paint, num, fSmall, now ? ACCENT : MUTED, pad, ty + S(1), numW, left);
            Put(g, paint, text, now ? fNow : fRow, now ? TEXT : DIM, pad + numW, ty, nameW, left);
            Put(g, paint, uses, fSmall, now ? TEXT : MUTED, pad + numW + nameW, ty + S(1), usesW, right);
            ty += h;
            if (hHelp > 0) { ty += S(2); Put(g, paint, nowHelp, fSmall, MUTED, pad + numW, ty, wide, left); ty += hHelp; }
            if (hWarn > 0) { ty += S(2); Put(g, paint, nowWarn, fSmall, BAD, pad + numW, ty, wide, left); }
            return y + total;
        }

        /// <summary>The panel, W pixels wide: painted, or only measured. Returns its height.</summary>
        int Draw(Graphics g, int W, bool paint)
        {
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            int pad = S(12), y = S(10);
            float inner = W - 2 * pad;
            using (StringFormat left = Fmt(StringAlignment.Near), right = Fmt(StringAlignment.Far))
            {
                if (paint) g.Clear(BG);
                if (moving) y += Put(g, paint, "Drag to place  ·  right-click when done", fSmall, TEXT, pad, y, inner, left) + S(6);
                // the route, and on its right what a finished craft costs and how often it finishes
                string head = (has ? title : "Route steps").ToUpperInvariant(), side = has ? sub : "";
                float sideW = WidthOf(g, side, fSmall, left);
                int hHead = Put(g, paint, head, fTitle, ACCENT, pad, y + S(1), inner - (sideW > 0 ? sideW + S(10) : 0), left);
                int hSide = Put(g, paint, side, fSmall, TEXT, pad, y, inner, right);
                y += Math.Max(hHead + S(1), hSide) + S(6);
                if (paint) using (Pen p = new Pen(LINE)) g.DrawLine(p, pad, y, W - pad, y);
                y += S(5);
                if (!has) y += Put(g, paint, "The steps of the route you pick in the assistant are shown here.", fSmall, MUTED, pad, y, inner, left);
                else
                {
                    int nowAt = -1;
                    for (int i = 0; i < rows.Count; i++) if (rows[i].Now) { nowAt = i; break; }
                    float numW = WidthOf(g, "00", fSmall, left) + S(7), usesW = 0;
                    foreach (Row r in rows) usesW = Math.Max(usesW, WidthOf(g, r.Uses, fSmall, left));
                    if (usesW > 0) usesW += S(10);
                    float nameW = inner - numW - usesW;
                    // the step to use now, when it is not one of the rows
                    if (nowAt < 0 && nowText.Length > 0) y = Block(g, paint, "»", nowText, "", true, y, W, numW, nameW, usesW, left, right) + S(2);
                    int first = 0, last = rows.Count;
                    if (rows.Count > MAX_ROWS)
                    {
                        first = Math.Max(0, Math.Min(Math.Max(0, nowAt) - MAX_ROWS / 2, rows.Count - MAX_ROWS));
                        last = first + MAX_ROWS;
                    }
                    if (first > 0) y += Put(g, paint, first + (first > 1 ? " earlier steps" : " earlier step"), fSmall, MUTED, pad + numW, y, nameW, left) + S(2);
                    for (int i = first; i < last; i++)
                        y = Block(g, paint, (i + 1).ToString(CultureInfo.InvariantCulture), rows[i].Text, rows[i].Uses, rows[i].Now, y, W, numW, nameW, usesW, left, right);
                    if (last < rows.Count) y += S(2) + Put(g, paint, (rows.Count - last) + (rows.Count - last > 1 ? " more steps" : " more step"), fSmall, MUTED, pad + numW, y + S(2), nameW, left);
                    if (msg.Length > 0) y += S(4) + Put(g, paint, msg, fNow, msgKind == "ok" ? OK : msgKind == "bad" ? BAD : TEXT, pad, y + S(4), inner, left);
                    if (foot.Length > 0)
                    {
                        y += S(7);
                        if (paint) using (Pen p = new Pen(LINE)) g.DrawLine(p, pad, y, W - pad, y);
                        y += S(5);
                        y += Put(g, paint, foot, fSmall, MUTED, pad, y, inner, left);
                    }
                }
                y += S(10);
                if (paint)
                {
                    using (Pen p = new Pen(LINE)) g.DrawRectangle(p, 0, 0, W - 1, y - 1);
                    using (SolidBrush b = new SolidBrush(ACCENT)) g.FillRectangle(b, 0, 0, W, S(2));
                }
            }
            return y;
        }

        protected override void OnPaint(PaintEventArgs e) { Draw(e.Graphics, ClientSize.Width, true); }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (!moving) return;
            if (e.Button == MouseButtons.Left) { dragging = true; grab = e.Location; }
            else if (e.Button == MouseButtons.Right && MoveEnded != null) MoveEnded(this, EventArgs.Empty);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (!dragging) return;
            Point c = Cursor.Position;
            Location = new Point(c.X - grab.X, c.Y - grab.Y);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!dragging || e.Button != MouseButtons.Left) return;
            dragging = false;
            if (Dropped != null) Dropped(this, EventArgs.Empty);
        }

        /// <summary>The panel for a JSON file, drawn into a PNG: its look can be checked without the game.</summary>
        public static void RenderToFile(string json, string png, float scale)
        {
            using (StepsOverlay o = new StepsOverlay())
            {
                o.SetScale(scale);
                o.SetSteps(json);
                int w = o.PanelWidth, h = o.PanelHeight;
                using (Bitmap b = new Bitmap(w, h))
                {
                    using (Graphics g = Graphics.FromImage(b)) o.Draw(g, w, true);
                    b.Save(png, System.Drawing.Imaging.ImageFormat.Png);
                }
            }
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
        readonly System.Windows.Forms.Timer copy = new System.Windows.Forms.Timer();
        uint seqBefore;
        int copyTicks, seenAt;
        IntPtr gameWnd = IntPtr.Zero;
        string copySource = "hotkey", lastText;
        DateTime lastAt = DateTime.MinValue;
        readonly bool anyWindow, noWindow;
        readonly string dir;
        bool registered;
        uint mods, vk;
        MenuItem topItem, keyItem, stepsItem, moveItem;
        // the chosen route's steps over the game
        readonly StepsOverlay steps = new StepsOverlay();
        readonly System.Windows.Forms.Timer stepsTimer = new System.Windows.Forms.Timer();
        int stepsSeen = -1, stepsMiss;
        bool stepsShown, stepsMoving;
        Rectangle stepsAt = Rectangle.Empty;
        IntPtr lastGame = IntPtr.Zero;
        int moveSeen;

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
            // Windows tells this window when the clipboard changes (nothing is polled, the clipboard is not owned)
            win.ClipboardChanged += delegate { OnClipboard(); };
            Native.AddClipboardFormatListener(win.Handle);
            copy.Interval = 15;
            copy.Tick += delegate { CopyTick(); };
            focus.Interval = 400;
            focus.Tick += delegate { WatchFocus(); };
            focus.Start();

            steps.SetOpacity(cfg.StepsOpacity);
            steps.Dropped += delegate { StepsDropped(); };
            steps.MoveEnded += delegate { SetMoving(false); };
            stepsTimer.Interval = 150;
            stepsTimer.Tick += delegate { StepsTick(); };
            stepsTimer.Start();

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
            MenuItem watchItem = null;
            watchItem = new MenuItem("Take items copied in game (Ctrl+C, other tools)", delegate { cfg.WatchClipboard = !cfg.WatchClipboard; cfg.Save(); watchItem.Checked = cfg.WatchClipboard; });
            watchItem.Checked = cfg.WatchClipboard;
            menu.MenuItems.Add(watchItem);
            stepsItem = new MenuItem("Route steps on the game screen", delegate { cfg.StepsOverlay = !cfg.StepsOverlay; cfg.Save(); stepsItem.Checked = cfg.StepsOverlay; });
            stepsItem.Checked = cfg.StepsOverlay;
            menu.MenuItems.Add(stepsItem);
            moveItem = new MenuItem("Move the route steps (drag, right-click when done)", delegate { SetMoving(!stepsMoving); });
            menu.MenuItems.Add(moveItem);
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

        /// <summary>
        /// Is this window the game? Its title says so; a browser tab or a chat whose title merely starts with the same
        /// words (a video, the trade site) does not count.
        /// </summary>
        bool IsGame(IntPtr h)
        {
            string t = Native.TitleOf(h);
            if (!t.StartsWith(cfg.GameTitle, StringComparison.OrdinalIgnoreCase)) return false;
            if (t.Length == cfg.GameTitle.Length) return true;
            string c = Native.ClassOf(h);
            return c != "Chrome_WidgetWin_1" && c != "MozillaWindowClass";
        }

        /// <summary>The hotkey is taken only while the game is in front, so it keeps its usual meaning elsewhere.</summary>
        void WatchFocus()
        {
            if (vk == 0) return;
            bool game = anyWindow || IsGame(Native.GetForegroundWindow());
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

        /// <summary>
        /// Copy the item under the cursor the way the player would (the game's own keys) and hand it to the page.
        /// The clipboard is only watched, never emptied or written: a program that owns the clipboard and is busy makes
        /// the game wait when it copies (the game froze for a moment on every press). The wait is a timer, so this
        /// program keeps answering Windows while the game writes the item.
        /// </summary>
        void OnHotkey()
        {
            if (copy.Enabled) return; // the copy of the last press is still under way
            gameWnd = Native.GetForegroundWindow(); // the game (the hotkey only exists while it is in front)
            copySource = "hotkey";
            seqBefore = Native.GetClipboardSequenceNumber();
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
            copyTicks = 0; seenAt = -1;
            copy.Start();
        }

        /// <summary>
        /// The clipboard changed while the game is in front: the player copied an item (Ctrl+C), or another tool did for
        /// its price check (Exiled Exchange 2, PoE Overlay II). The item goes to the page as well, so one key press of
        /// that tool also feeds the craft assistant. This program's own hotkey is handled by its own wait.
        /// </summary>
        void OnClipboard()
        {
            if (!cfg.WatchClipboard || copy.Enabled) return;
            IntPtr fg = Native.GetForegroundWindow();
            if (!anyWindow && !IsGame(fg)) return;
            gameWnd = fg;
            copySource = "clipboard";
            copyTicks = 0; seenAt = 0; // read after two ticks, once the writer is done
            copy.Start();
        }

        /// <summary>Every 15 ms after a press: has the game written the clipboard? Then read it once and pass it on.</summary>
        void CopyTick()
        {
            copyTicks++;
            if (seenAt < 0)
            {
                if (Native.GetClipboardSequenceNumber() != seqBefore) seenAt = copyTicks; // a counter: the clipboard is not opened
                else if (copyTicks > 40) copy.Stop(); // nothing under the cursor: nothing was copied
                return;
            }
            if (copyTicks < seenAt + 2) return; // let the game finish writing
            string text = null;
            try { if (Clipboard.ContainsText()) text = Clipboard.GetText(); } catch (Exception) { }
            if (text == null && copyTicks < seenAt + 12) return; // still busy: once more
            copy.Stop();
            if (text == null || text.IndexOf("Rarity:", StringComparison.Ordinal) < 0) return; // not an item
            // the same text twice in a row (a tool that writes the clipboard in two steps) is one copy
            if (text == lastText && (DateTime.UtcNow - lastAt).TotalMilliseconds < 1500) return;
            lastText = text; lastAt = DateTime.UtcNow;
            int reached = server.Push(text, copySource);
            if (copySource != "hotkey") return; // another tool's copy: its own window is what the player looks at
            if (reached == 0) OpenWindow(false); // the window was closed: open it, the page takes the item on the next press
            else ShowAbove(!(cfg.StepsOverlay && steps.HasSteps)); // with the steps on the game screen, a minimised window stays so
        }

        /// <summary>The game's picture area on the screen (without frame and title bar).</summary>
        static bool ClientArea(IntPtr h, out Rectangle area)
        {
            area = Rectangle.Empty;
            Native.RECT c;
            Native.POINT p = new Native.POINT();
            if (!Native.GetClientRect(h, out c) || !Native.ClientToScreen(h, ref p)) return false;
            area = new Rectangle(p.X, p.Y, c.Right - c.Left, c.Bottom - c.Top);
            return area.Width >= 320 && area.Height >= 240;
        }

        bool GameThere()
        {
            return lastGame != IntPtr.Zero && Native.IsWindow(lastGame) && Native.IsWindowVisible(lastGame) && !Native.IsIconic(lastGame);
        }

        /// <summary>Where the steps are placed in: the game's picture, or the main screen while there is no game window.</summary>
        Rectangle StepsArea()
        {
            Rectangle area;
            return GameThere() && ClientArea(lastGame, out area) ? area : Screen.PrimaryScreen.Bounds;
        }

        void StepsState()
        {
            server.OverlayState = "\"visible\":" + (stepsShown ? "true" : "false") + ",\"moving\":" + (stepsMoving ? "true" : "false")
                + ",\"bounds\":[" + stepsAt.X + "," + stepsAt.Y + "," + stepsAt.Width + "," + stepsAt.Height + "]";
        }

        /// <summary>
        /// Every 150 ms: take what the page sent last, and show the steps while the game is the window in front (or the
        /// assistant's own window with the game behind it, so a route picked there is seen to arrive). Any other program
        /// in front hides them. The panel is placed only when its place changes: every change of the window order makes
        /// the game redraw.
        /// </summary>
        void StepsTick()
        {
            bool fresh = false;
            int ask = server.MoveAsk;
            if (ask != moveSeen) { moveSeen = ask; SetMoving(!stepsMoving); }
            int v = server.StepsVersion;
            if (v != stepsSeen) { stepsSeen = v; steps.SetSteps(server.StepsJson); fresh = true; }
            IntPtr fg = Native.GetForegroundWindow();
            bool game = IsGame(fg);
            if (game) lastGame = fg;
            bool want = stepsMoving || (cfg.StepsOverlay && steps.HasSteps && server.Clients > 0
                && (game || anyWindow || (GameThere() && Native.TitleOf(fg) == PAGE_TITLE)));
            if (!want)
            {
                // two looks in a row: the window in front is nobody's for a moment while windows change places
                if (stepsShown && ++stepsMiss >= 2) { Native.ShowWindow(steps.Handle, 0); stepsShown = false; StepsState(); }
                return;
            }
            stepsMiss = 0;
            if (steps.Dragging) return;
            Rectangle area = StepsArea();
            // as large as the game draws its own interface: by the height of its picture
            steps.SetScale((float)Math.Max(0.7, Math.Min(3.0, area.Height / 1080.0 * cfg.StepsScale / 100.0)));
            int w = Math.Min(steps.PanelWidth, area.Width), h = Math.Min(steps.PanelHeight, area.Height);
            int x = area.Left + (int)Math.Round(area.Width * cfg.StepsX / 100.0) - w / 2, y = area.Top + (int)Math.Round(area.Height * cfg.StepsY / 100.0);
            x = Math.Max(area.Left, Math.Min(area.Right - w, x));
            y = Math.Max(area.Top, Math.Min(area.Bottom - h, y));
            Rectangle at = new Rectangle(x, y, w, h);
            if (at != stepsAt || !stepsShown)
            {
                Native.SetWindowPos(steps.Handle, Native.HWND_TOPMOST, x, y, w, h, Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
                stepsAt = at; stepsShown = true;
                StepsState();
            }
            if (fresh) steps.Invalidate();
        }

        /// <summary>Tray menu: the panel takes the mouse and can be dragged; again (or a right-click on it) and it is fixed.</summary>
        void SetMoving(bool on)
        {
            stepsMoving = on;
            steps.Moving = on;
            moveItem.Checked = on;
            stepsAt = Rectangle.Empty; // its height changed (the line that says how to move it)
            StepsState();
        }

        /// <summary>The panel was dragged: its place is kept as a share of the game's picture, so it holds at any size.</summary>
        void StepsDropped()
        {
            Rectangle area = StepsArea(), b = steps.Bounds;
            cfg.StepsX = Math.Round(Math.Max(0, Math.Min(100, (b.Left + b.Width / 2.0 - area.Left) * 100.0 / area.Width)), 1);
            cfg.StepsY = Math.Round(Math.Max(0, Math.Min(100, (b.Top - area.Top) * 100.0 / area.Height)), 1);
            cfg.Save();
            stepsAt = Rectangle.Empty;
        }

        /// <summary>
        /// The assistant's own browser profile does not offer to translate its pages (they are in English on purpose).
        /// The setting is written while no window of the profile is open; the browser reads it when it starts.
        /// </summary>
        static void NoTranslate(string profile)
        {
            try
            {
                if (File.Exists(Path.Combine(profile, "lockfile"))) return; // the browser is running with this profile
                string dir = Path.Combine(profile, "Default"), file = Path.Combine(dir, "Preferences");
                JavaScriptSerializer js = new JavaScriptSerializer();
                js.MaxJsonLength = int.MaxValue;
                js.RecursionLimit = 400;
                Dictionary<string, object> prefs = File.Exists(file) ? js.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)) : null;
                if (prefs == null) prefs = new Dictionary<string, object>();
                Dictionary<string, object> tr = prefs.ContainsKey("translate") ? prefs["translate"] as Dictionary<string, object> : null;
                if (tr == null) { tr = new Dictionary<string, object>(); prefs["translate"] = tr; }
                if (tr.ContainsKey("enabled") && tr["enabled"] is bool && !(bool)tr["enabled"]) return; // off already
                tr["enabled"] = false;
                Directory.CreateDirectory(dir);
                File.WriteAllText(file, js.Serialize(prefs), new UTF8Encoding(false));
            }
            catch (Exception) { /* unreadable, or in use after all: the page's own "do not translate" mark remains */ }
        }

        /// <summary>A page of this program in its own window (Edge's app mode, the assistant's own profile).</summary>
        void Launch(string url, string size)
        {
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
                    NoTranslate(profile);
                    Process.Start(edge, "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=" + size + " --no-first-run --no-default-browser-check --disable-features=Translate"
                        // minimised or behind the game, the page still plans and answers at once (the steps over the game follow it)
                        + " --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows");
                }
                else Process.Start(url); // the default browser
            }
            catch (Exception e) { tray.ShowBalloonTip(6000, PAGE_TITLE, "The window could not be opened (" + e.Message + "). Open " + url + " in a browser.", ToolTipIcon.Warning); }
        }

        /// <summary>The assistant's window above the game without taking the keyboard from it.</summary>
        void ShowAbove(bool restore)
        {
            if (!cfg.Topmost) return;
            IntPtr h = Native.FindWindowByTitle(PAGE_TITLE);
            if (h == IntPtr.Zero) return;
            if (Native.IsIconic(h)) { if (!restore) return; Native.ShowWindow(h, 4); } // SW_SHOWNOACTIVATE
            // only when it is not above already: every change of the window order makes the game redraw
            if ((Native.GetWindowLong(h, -20) & 8) == 0) Native.SetWindowPos(h, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
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
            Launch(server.Url, "560,960");
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
            try { focus.Stop(); copy.Stop(); stepsTimer.Stop(); steps.Close(); Native.RemoveClipboardFormatListener(win.Handle); if (registered) Native.UnregisterHotKey(win.Handle, 1); } catch (Exception) { }
            // the window goes with the program: without it the page has nothing to load from
            try
            {
                IntPtr h = Native.FindWindowByTitle(PAGE_TITLE);
                if (h != IntPtr.Zero) Native.PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
            }
            catch (Exception) { }
            if (server != null) server.Stop();
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }
    }
}
