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
        public string Hotkey = "Alt+E";
        public int Port = 47652;
        public bool Topmost = true;        // keep the assistant's window above the game
        public bool AdvancedCopy = true;   // Alt+Ctrl+C (modifier tiers) instead of Ctrl+C
        public bool Overlay = false;       // the trade search of a copied item as a panel over the game
        public bool WatchClipboard = true; // take every item copied in game (Ctrl+C, another tool's price check)
        public bool PriceCheck = true;     // on the hotkey, ask the trade site for the item's listings (see Trade)
        public double OverlayWidth = 0.42; // the panel's share of the game window's width
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
                    if (d.ContainsKey("overlay")) c.Overlay = Convert.ToBoolean(d["overlay"]);
                    if (d.ContainsKey("watchClipboard")) c.WatchClipboard = Convert.ToBoolean(d["watchClipboard"]);
                    if (d.ContainsKey("priceCheck")) c.PriceCheck = Convert.ToBoolean(d["priceCheck"]);
                    if (d.ContainsKey("overlayWidth")) c.OverlayWidth = Convert.ToDouble(d["overlayWidth"], System.Globalization.CultureInfo.InvariantCulture);
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
                    + ",\r\n  \"watchClipboard\": " + (WatchClipboard ? "true" : "false") + ",\r\n  \"priceCheck\": " + (PriceCheck ? "true" : "false")
                    + ",\r\n  \"overlay\": " + (Overlay ? "true" : "false") + ",\r\n  \"overlayWidth\": " + OverlayWidth.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "\r\n}\r\n";
                System.IO.File.WriteAllText(File, json);
            }
            catch (Exception) { /* read-only folder: the settings last until exit */ }
        }

        public static string Json(string s) { return new JavaScriptSerializer().Serialize(s); }
    }

    /// <summary>
    /// One price check: the trade site's search for an item and its first listings, the way price check tools do it
    /// (Exiled Exchange 2, PoE Overlay II). These endpoints are not in Grinding Gear Games' documented API; the player
    /// chose to use them knowingly, no further than those tools go (6 Oct 2026). So the limits are kept tight:
    /// only on the player's key press or Search click, never in the background; one search and one fetch of ten
    /// listings; the site's rate limit headers obeyed with a margin; no account cookies (a search the site wants a
    /// login for is refused here and left to the trade site itself); a refusal by the site is never worked around.
    /// </summary>
    class Trade
    {
        const string UA = "PoE2CraftAssistant/1.0 (personal price check, one search per key press)";
        readonly object gate = new object();
        readonly JavaScriptSerializer ser = new JavaScriptSerializer();
        readonly Dictionary<string, KeyValuePair<DateTime, string>> cache = new Dictionary<string, KeyValuePair<DateTime, string>>();
        DateTime nextSearch = DateTime.MinValue, nextFetch = DateTime.MinValue;

        public Trade()
        {
            ser.MaxJsonLength = 16 * 1024 * 1024;
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        }

        class Reply { public int Status; public string Body = ""; public double Wait; public string Message; public bool Login; }

        static object Get(object o, string key)
        {
            Dictionary<string, object> d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) ? v : null;
        }

        string Fail(string message, double wait, bool login)
        {
            Dictionary<string, object> m = new Dictionary<string, object>();
            m["ok"] = false; m["message"] = message; m["wait"] = Math.Max(0, Math.Ceiling(wait)); m["login"] = login;
            return ser.Serialize(m);
        }

        /// <summary>Seconds to leave before the next request, from the site's own rate limit headers (with a margin).</summary>
        static double WaitFrom(WebHeaderCollection h)
        {
            double wait = 0, v;
            if (h["Retry-After"] != null && double.TryParse(h["Retry-After"], out v)) wait = Math.Max(wait, v);
            string rules = h["X-Rate-Limit-Rules"];
            if (rules == null) return wait;
            foreach (string rule in rules.Split(','))
            {
                string lim = h["X-Rate-Limit-" + rule.Trim()], state = h["X-Rate-Limit-" + rule.Trim() + "-State"];
                if (lim == null || state == null) continue;
                string[] L = lim.Split(','), S = state.Split(',');
                for (int i = 0; i < L.Length && i < S.Length; i++)
                {
                    string[] l = L[i].Split(':'), st = S[i].Split(':'); // limit: max:period:penalty, state: hits:period:penalty in force
                    int max, period, hits, active;
                    if (l.Length < 2 || st.Length < 3 || !int.TryParse(l[0], out max) || !int.TryParse(l[1], out period) || !int.TryParse(st[0], out hits) || !int.TryParse(st[2], out active)) continue;
                    if (active > 0) wait = Math.Max(wait, active);
                    else if (hits >= max - 1) wait = Math.Max(wait, period);                 // one below the limit: sit the window out
                    else if (hits * 2 >= max) wait = Math.Max(wait, (double)period / max);   // half used: spread the rest
                }
            }
            return wait;
        }

        Reply Send(string method, string url, string body)
        {
            Reply r = new Reply();
            HttpWebResponse resp = null;
            try
            {
                HttpWebRequest q = (HttpWebRequest)WebRequest.Create(url);
                q.Method = method;
                q.UserAgent = UA;
                q.Accept = "application/json";
                q.Timeout = 12000;
                q.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                if (body != null)
                {
                    byte[] b = Encoding.UTF8.GetBytes(body);
                    q.ContentType = "application/json";
                    q.ContentLength = b.Length;
                    using (Stream o = q.GetRequestStream()) o.Write(b, 0, b.Length);
                }
                try { resp = (HttpWebResponse)q.GetResponse(); }
                catch (WebException e)
                {
                    resp = e.Response as HttpWebResponse;
                    if (resp == null) { r.Status = 0; r.Message = "The trade site could not be reached (" + e.Message + ")."; return r; }
                }
                r.Status = (int)resp.StatusCode;
                r.Wait = WaitFrom(resp.Headers);
                using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) r.Body = sr.ReadToEnd();
                if (r.Status != 200)
                {
                    string msg = null;
                    try { msg = Convert.ToString(Get(Get(ser.DeserializeObject(r.Body), "error"), "message")); } catch (Exception) { msg = null; }
                    if (r.Status == 429) r.Message = "The trade site's rate limit was reached. Wait " + Math.Ceiling(Math.Max(r.Wait, 1)) + " s.";
                    else if (!string.IsNullOrEmpty(msg)) r.Message = msg;
                    else r.Message = "The trade site refused the request (HTTP " + r.Status + "). Use the trade site itself for this search.";
                    r.Login = msg != null && msg.IndexOf("log", StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
            catch (Exception e) { r.Status = 0; r.Message = "The price check failed (" + e.Message + ")."; }
            finally { if (resp != null) resp.Close(); }
            return r;
        }

        /// <summary>The search and its first ten listings as JSON for the page: {ok, total, id, listings} or {ok:false, message, wait, login}.</summary>
        public string Check(string league, string body, bool fresh)
        {
            lock (gate)
            {
                string key = league + "\n" + body;
                KeyValuePair<DateTime, string> hit;
                // the same search again within a minute: the answer already here (Refresh asks the site again)
                if (!fresh && cache.TryGetValue(key, out hit) && (DateTime.UtcNow - hit.Key).TotalSeconds < 60) return hit.Value;
                double wait = (nextSearch - DateTime.UtcNow).TotalSeconds;
                if (wait > 0) return Fail("Too soon after the last search: wait " + Math.Ceiling(wait) + " s (the trade site's rate limit).", wait, false);
                Reply sr = Send("POST", "https://www.pathofexile.com/api/trade2/search/poe2/" + Uri.EscapeDataString(league), body);
                nextSearch = DateTime.UtcNow.AddSeconds(Math.Max(2.0, sr.Wait));
                if (sr.Status != 200) return Fail(sr.Message, sr.Wait, sr.Login);
                object found;
                try { found = ser.DeserializeObject(sr.Body); } catch (Exception) { return Fail("The trade site's answer could not be read.", 0, false); }
                string id = Convert.ToString(Get(found, "id"));
                int total = 0;
                try { total = Convert.ToInt32(Get(found, "total")); } catch (Exception) { total = 0; }
                List<string> ids = new List<string>();
                System.Collections.IEnumerable res = Get(found, "result") as System.Collections.IEnumerable;
                if (res != null) foreach (object x in res) { if (ids.Count >= 10) break; ids.Add(Convert.ToString(x)); }
                List<object> listings = new List<object>();
                if (ids.Count > 0)
                {
                    double fw = (nextFetch - DateTime.UtcNow).TotalSeconds;
                    if (fw > 0) return Fail("Too soon after the last search: wait " + Math.Ceiling(fw) + " s (the trade site's rate limit).", fw, false);
                    Reply fr = Send("GET", "https://www.pathofexile.com/api/trade2/fetch/" + string.Join(",", ids.ToArray()) + "?query=" + Uri.EscapeDataString(id) + "&realm=poe2", null);
                    nextFetch = DateTime.UtcNow.AddSeconds(Math.Max(1.0, fr.Wait));
                    if (fr.Status != 200) return Fail(fr.Message, fr.Wait, fr.Login);
                    System.Collections.IEnumerable rows = null;
                    try { rows = Get(ser.DeserializeObject(fr.Body), "result") as System.Collections.IEnumerable; } catch (Exception) { rows = null; }
                    if (rows != null) foreach (object row in rows)
                    {
                        object listing = Get(row, "listing"), price = Get(listing, "price"), account = Get(listing, "account");
                        if (price == null) continue;
                        Dictionary<string, object> o = new Dictionary<string, object>();
                        o["amount"] = Get(price, "amount");
                        o["currency"] = Get(price, "currency");
                        o["indexed"] = Get(listing, "indexed");
                        o["seller"] = Get(account, "name");
                        o["online"] = Get(account, "online") != null;
                        object item = Get(row, "item");
                        o["ilvl"] = Get(item, "ilvl");
                        // quality from the item's property line ("Quality": "+20%")
                        System.Collections.IEnumerable props = Get(item, "properties") as System.Collections.IEnumerable;
                        if (props != null) foreach (object pr in props)
                        {
                            if (Convert.ToString(Get(pr, "name")).IndexOf("Quality", StringComparison.OrdinalIgnoreCase) < 0) continue;
                            System.Collections.IEnumerable vals = Get(pr, "values") as System.Collections.IEnumerable;
                            if (vals != null) foreach (object v in vals)
                            {
                                System.Collections.IEnumerable pair = v as System.Collections.IEnumerable;
                                if (pair != null) foreach (object x in pair) { o["quality"] = Convert.ToString(x).Trim('+', '%'); break; }
                                break;
                            }
                            break;
                        }
                        listings.Add(o);
                    }
                }
                Dictionary<string, object> m = new Dictionary<string, object>();
                m["ok"] = true; m["total"] = total; m["id"] = id; m["listings"] = listings;
                string json = ser.Serialize(m);
                if (cache.Count > 40) cache.Clear();
                cache[key] = new KeyValuePair<DateTime, string>(DateTime.UtcNow, json);
                return json;
            }
        }
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
        /// <summary>The page asks for the price panel over the game ("show") or to put it away ("hide").</summary>
        public Action<string> OnOverlay;
        readonly Trade trade = new Trade();
        string lastJson = "{}";

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
            if (path == "/last") { Text(r, 200, "application/json", lastJson); return; } // the item copied last (a window opened after it)
            if (path == "/trade" && q.HttpMethod == "POST")
            {
                string origin = q.Headers["Origin"];
                if (origin != null && origin.TrimEnd('/') != Url.TrimEnd('/')) { Text(r, 403, "text/plain", "forbidden"); return; }
                string body;
                using (StreamReader sr = new StreamReader(q.InputStream, Encoding.UTF8)) body = sr.ReadToEnd();
                string league = q.QueryString["league"];
                if (!cfg.PriceCheck) { Text(r, 200, "application/json", "{\"ok\":false,\"message\":\"The price check is turned off (tray menu).\",\"wait\":0,\"login\":false}"); return; }
                if (string.IsNullOrEmpty(league) || string.IsNullOrEmpty(body)) { Text(r, 400, "text/plain", "league and search needed"); return; }
                Text(r, 200, "application/json", trade.Check(league, body, q.QueryString["fresh"] == "1"));
                return;
            }
            if (path == "/overlay" && q.HttpMethod == "POST")
            {
                string origin = q.Headers["Origin"];
                if (origin != null && origin.TrimEnd('/') != Url.TrimEnd('/')) { Text(r, 403, "text/plain", "forbidden"); return; }
                string cmd;
                using (StreamReader sr = new StreamReader(q.InputStream, Encoding.UTF8)) cmd = sr.ReadToEnd().Trim();
                if (OnOverlay != null) OnOverlay(cmd);
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
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);

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

    class Host : ApplicationContext
    {
        const string PAGE_TITLE = "PoE2 Craft Assistant";
        const string PRICE_TITLE = "PoE2 Price Check";
        readonly Config cfg;
        readonly Server server;
        readonly NotifyIcon tray;
        readonly HotkeyWindow win = new HotkeyWindow();
        readonly System.Windows.Forms.Timer focus = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer copy = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer panel = new System.Windows.Forms.Timer();
        uint seqBefore;
        int copyTicks, seenAt;
        IntPtr gameWnd = IntPtr.Zero;
        string copySource = "hotkey", lastText;
        DateTime lastAt = DateTime.MinValue;
        long panelWanted; // ticks until which the price panel is to be placed over the game (0: nothing asked, -1: hide)
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
            // Windows tells this window when the clipboard changes (nothing is polled, the clipboard is not owned)
            win.ClipboardChanged += delegate { OnClipboard(); };
            Native.AddClipboardFormatListener(win.Handle);
            copy.Interval = 15;
            copy.Tick += delegate { CopyTick(); };
            // the page asks for the panel from the server's thread; the window work is done here, on the program's own
            server.OnOverlay = delegate(string cmd) { Interlocked.Exchange(ref panelWanted, cmd == "hide" ? -1 : DateTime.UtcNow.AddSeconds(4).Ticks); };
            panel.Interval = 120;
            panel.Tick += delegate { PanelTick(); };
            panel.Start();
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
            MenuItem watchItem = null;
            watchItem = new MenuItem("Take items copied in game (Ctrl+C, other price check tools)", delegate { cfg.WatchClipboard = !cfg.WatchClipboard; cfg.Save(); watchItem.Checked = cfg.WatchClipboard; });
            watchItem.Checked = cfg.WatchClipboard;
            menu.MenuItems.Add(watchItem);
            MenuItem panelItem = null;
            panelItem = new MenuItem("Price check on the hotkey (asks the trade site)", delegate { cfg.PriceCheck = !cfg.PriceCheck; cfg.Save(); panelItem.Checked = cfg.PriceCheck; if (!cfg.PriceCheck) HidePanel(); });
            panelItem.Checked = cfg.PriceCheck;
            menu.MenuItems.Add(panelItem);
            menu.MenuItems.Add("Hide the price check", delegate { HidePanel(); });
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
            if (!anyWindow && !Native.TitleOf(fg).StartsWith(cfg.GameTitle, StringComparison.OrdinalIgnoreCase)) return;
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
                else if (copyTicks > 40) { copy.Stop(); HidePanel(); } // nothing under the cursor: the price panel goes away
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
            else ShowAbove();
            if (cfg.PriceCheck)
            {
                // the price check window over the game (it opens on the first press and reads the item it missed)
                if (Native.FindWindowByTitle(PRICE_TITLE) == IntPtr.Zero) Launch(server.Url + "?view=price", "600,1000");
                Interlocked.Exchange(ref panelWanted, DateTime.UtcNow.AddSeconds(10).Ticks);
            }
        }

        /// <summary>The price check window at the top right of the game, above it, the keyboard left with the game.</summary>
        void PanelTick()
        {
            long want = Interlocked.Read(ref panelWanted);
            if (want == 0) return;
            if (want < 0) { Interlocked.Exchange(ref panelWanted, 0); HidePanel(); return; }
            if (DateTime.UtcNow.Ticks > want) { Interlocked.Exchange(ref panelWanted, 0); return; }
            IntPtr t = Native.FindWindowByTitle(PRICE_TITLE);
            if (t == IntPtr.Zero) return; // still opening
            Interlocked.Exchange(ref panelWanted, 0);
            Native.RECT g;
            if (gameWnd == IntPtr.Zero || !Native.GetWindowRect(gameWnd, out g))
            {
                Rectangle s = Screen.PrimaryScreen.WorkingArea;
                g.Left = s.Left; g.Top = s.Top; g.Right = s.Right; g.Bottom = s.Bottom;
            }
            int gw = g.Right - g.Left, gh = g.Bottom - g.Top;
            int w = Math.Min(gw, 600), h = Math.Max(480, Math.Min(gh - 90, 1120));
            if (Native.IsIconic(t)) Native.ShowWindow(t, 4); // SW_SHOWNOACTIVATE
            Native.SetWindowPos(t, Native.HWND_TOPMOST, g.Right - w - 14, g.Top + 44, w, h, Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
            // a window that was just created takes the keyboard: hand it back to the game
            if (gameWnd != IntPtr.Zero && Native.GetForegroundWindow() == t) Native.SetForegroundWindow(gameWnd);
        }

        void HidePanel()
        {
            IntPtr t = Native.FindWindowByTitle(PRICE_TITLE);
            if (t != IntPtr.Zero && !Native.IsIconic(t)) Native.ShowWindow(t, 7); // SW_SHOWMINNOACTIVE
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
                    Process.Start(edge, "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=" + size + " --no-first-run --no-default-browser-check");
                }
                else Process.Start(url); // the default browser
            }
            catch (Exception e) { tray.ShowBalloonTip(6000, PAGE_TITLE, "The window could not be opened (" + e.Message + "). Open " + url + " in a browser.", ToolTipIcon.Warning); }
        }

        /// <summary>The assistant's window above the game without taking the keyboard from it.</summary>        /// <summary>The assistant's window above the game without taking the keyboard from it.</summary>
        void ShowAbove()
        {
            if (!cfg.Topmost) return;
            IntPtr h = Native.FindWindowByTitle(PAGE_TITLE);
            if (h == IntPtr.Zero) return;
            if (Native.IsIconic(h)) Native.ShowWindow(h, 4); // SW_SHOWNOACTIVATE
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
            try { focus.Stop(); copy.Stop(); panel.Stop(); Native.RemoveClipboardFormatListener(win.Handle); if (registered) Native.UnregisterHotKey(win.Handle, 1); } catch (Exception) { }
            // the window goes with the program: without it the page has nothing to load from
            try
            {
                foreach (string title in new string[] { PRICE_TITLE, PAGE_TITLE })
                {
                    IntPtr h = Native.FindWindowByTitle(title);
                    if (h != IntPtr.Zero) Native.PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
                }
            }
            catch (Exception) { }
            if (server != null) server.Stop();
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }
    }
}
