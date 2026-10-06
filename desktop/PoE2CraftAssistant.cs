// PoE2 Craft Assistant, desktop helper.
//
// A tray program that serves the Craft Assistant page from this folder on localhost, opens it in its own window, and
// while Path of Exile 2 is the window in front listens for one hotkey (default Alt+E). On the hotkey it presses the
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
                try { Native.SetProcessDPIAware(); } catch (Exception) { }
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
        public int PriceWidth = 455;       // the price check window's size (at 100% display scaling); it is placed
        public int PriceHeight = 1110;     // beside the game's inventory and is never taller than the game
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
                    if (d.ContainsKey("priceWidth")) c.PriceWidth = Convert.ToInt32(d["priceWidth"]);
                    if (d.ContainsKey("priceHeight")) c.PriceHeight = Convert.ToInt32(d["priceHeight"]);
                    else c.Save(); // a file from before this setting: written again with every setting in it
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
                    + ",\r\n  \"watchClipboard\": " + (WatchClipboard ? "true" : "false") + ",\r\n  \"priceCheck\": " + (PriceCheck ? "true" : "false") + ",\r\n  \"priceWidth\": " + PriceWidth + ",\r\n  \"priceHeight\": " + PriceHeight
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
        readonly HashSet<HttpListenerResponse> viewers = new HashSet<HttpListenerResponse>(); // price check windows among them
        readonly string root;
        readonly Config cfg;
        Thread thread;
        System.Threading.Timer ping;
        public string Url;
        /// <summary>
        /// The page asks for the price panel over the game ("show") or to put it away ("hide"); the price check's page
        /// tells how large it is inside its window ("size W H", in pixels).
        /// </summary>
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
                lock (clients) { clients.Add(r); if (q.QueryString["view"] == "price") viewers.Add(r); }
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
            if (path == "/" || path == "/price") path = "/index.html"; // "/price": the price check window (the same page)
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

        /// <summary>An item text for the pages. Returns the number of assistant pages it reached (price check windows aside).</summary>
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
                    try { clients[i].OutputStream.Write(b, 0, b.Length); clients[i].OutputStream.Flush(); if (!viewers.Contains(clients[i])) ok++; }
                    catch (Exception) { try { clients[i].Abort(); } catch (Exception) { } viewers.Remove(clients[i]); clients.RemoveAt(i); }
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
        public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40;
        public const int GWL_EXSTYLE = -20, WS_EX_TOPMOST = 8, WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;

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
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);
        [DllImport("user32.dll")] public static extern int GetWindowRgnBox(IntPtr hWnd, out RECT box);
        [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint thread, uint to, bool attach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

        /// <summary>
        /// Give the keyboard to a window. Windows lets only the program in front do that, so for the moment of the
        /// request this thread joins the input of the window that has the keyboard now.
        /// </summary>
        public static void Focus(IntPtr h)
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == h || h == IntPtr.Zero) return;
            uint pid, mine = GetCurrentThreadId(), other = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out pid) : 0;
            bool joined = other != 0 && other != mine && AttachThreadInput(mine, other, true);
            SetForegroundWindow(h);
            if (joined) AttachThreadInput(mine, other, false);
        }
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
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
        /// With "hidden" a window that is not shown counts as well (the price check between two key presses).
        /// </summary>
        public static IntPtr FindWindowByTitle(string title, bool hidden = false)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                if (TitleOf(h) != title) return true;
                if (!IsWindowVisible(h))
                {
                    if (!hidden) return true;
                    StringBuilder cls = new StringBuilder(64);
                    GetClassName(h, cls, cls.Capacity);
                    if (cls.ToString() != "Chrome_WidgetWin_1") return true; // the browser's own window, not one of its helpers
                }
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
        IntPtr priceWnd = IntPtr.Zero, priceReady = IntPtr.Zero; // the price check window (shown or hidden); the one made ready
        long priceAsked, openAhead; // ticks: when the browser was last asked for that window; when to open it ahead of its use
        long pageSize;              // the price check page's size in pixels as the page tells it (width << 32 | height; 0: not told)
        int titleBar = -1;          // height of the browser's title bar above that page in pixels (-1: not measured yet)
        int away;                   // ticks in a row with another program in front
        bool panelOn;               // the price check is shown because a key press asked for it
        Native.RECT panelRect;      // where on the screen the price check's page is to be
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
            server.OnOverlay = delegate(string cmd)
            {
                if (cmd.StartsWith("size ", StringComparison.Ordinal))
                {
                    string[] p = cmd.Split(' ');
                    int w, h;
                    if (p.Length == 3 && int.TryParse(p[1], out w) && int.TryParse(p[2], out h) && w > 0 && h > 0) Interlocked.Exchange(ref pageSize, ((long)w << 32) | (uint)h);
                    return;
                }
                Interlocked.Exchange(ref panelWanted, cmd == "hide" ? -1 : DateTime.UtcNow.AddSeconds(4).Ticks);
            };
            panel.Interval = 120;
            panel.Tick += delegate { PanelTick(); };
            panel.Start();
            focus.Interval = 400;
            focus.Tick += delegate { WatchFocus(); };
            focus.Start();

            if (!noWindow)
            {
                OpenWindow(true);
                // the price check window is opened ahead and kept hidden, so a key press in game only has to show it
                openAhead = DateTime.UtcNow.AddSeconds(3).Ticks;
            }
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
                // the price check window over the game (a window that was closed opens again and reads the item it missed)
                EnsurePrice();
                Interlocked.Exchange(ref panelWanted, DateTime.UtcNow.AddSeconds(10).Ticks);
                PanelTick(); // now, not on the next tick
            }
        }

        bool IsGame(IntPtr h) { return h != IntPtr.Zero && Native.TitleOf(h).StartsWith(cfg.GameTitle, StringComparison.OrdinalIgnoreCase); }

        /// <summary>The price check window, shown or hidden; none when it is not open (or still opening).</summary>
        IntPtr PriceWindow()
        {
            if (priceWnd != IntPtr.Zero && Native.IsWindow(priceWnd) && Native.TitleOf(priceWnd) == PRICE_TITLE) return priceWnd;
            priceWnd = Native.FindWindowByTitle(PRICE_TITLE, true);
            return priceWnd;
        }

        /// <summary>Ask the browser for the price check window unless it is there (or was asked for a moment ago).</summary>
        void EnsurePrice()
        {
            if (!cfg.PriceCheck || PriceWindow() != IntPtr.Zero) return;
            long now = DateTime.UtcNow.Ticks;
            if (now - priceAsked < 8 * TimeSpan.TicksPerSecond) return; // the browser is still opening it
            priceAsked = now;
            // its own address: the browser remembers a window's place by the address, and this one's is not the assistant's
            Launch(server.Url + "price", (cfg.PriceWidth + 16) + "," + (cfg.PriceHeight + 39));
        }

        /// <summary>
        /// A price check window the browser has just opened: put away until a key press asks for it, marked as a tool
        /// window (no button on the taskbar, not among the windows of Alt+Tab) and set above the other windows.
        /// </summary>
        void Prepare(IntPtr t)
        {
            priceReady = t;
            panelOn = false;
            Native.ShowWindow(t, 0); // SW_HIDE: Windows hands the keyboard back to the window that had it
            int ex = Native.GetWindowLong(t, Native.GWL_EXSTYLE);
            Native.SetWindowLong(t, Native.GWL_EXSTYLE, (ex | Native.WS_EX_TOOLWINDOW) & ~Native.WS_EX_APPWINDOW);
            Above(t);
        }

        /// <summary>
        /// The window above the game ("always on top"). Asked for in two steps: a window the browser has just opened
        /// answers "done" to the plain request and stays below the other windows, until its place in the order has been
        /// set once (tried on the price check window: "not on top" first, then "on top", works every time).
        /// </summary>
        static void Above(IntPtr t)
        {
            if ((Native.GetWindowLong(t, Native.GWL_EXSTYLE) & Native.WS_EX_TOPMOST) != 0) return;
            Native.SetWindowPos(t, Native.HWND_NOTOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            Native.SetWindowPos(t, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        /// <summary>The game's picture on the screen; with no game window known, the screen the cursor is on.</summary>
        Native.RECT GameArea()
        {
            Native.RECT g, c;
            Native.POINT o = new Native.POINT();
            if (IsGame(gameWnd) && !Native.IsIconic(gameWnd) && Native.GetClientRect(gameWnd, out c) && c.Right > 0 && c.Bottom > 0 && Native.ClientToScreen(gameWnd, ref o))
            {
                g.Left = o.X; g.Top = o.Y; g.Right = o.X + c.Right; g.Bottom = o.Y + c.Bottom;
                return g;
            }
            Rectangle s = Screen.FromPoint(Cursor.Position).Bounds;
            g.Left = s.Left; g.Top = s.Top; g.Right = s.Right; g.Bottom = s.Bottom;
            return g;
        }

        /// <summary>
        /// Where the price check goes: at the top, beside the game's side panel the cursor is over. The side panels (the
        /// inventory at the right, the stash or a vendor at the left) are 370/600 of the game's height wide at every
        /// resolution, so the window lies in the free space left of the inventory, or right of the stash. Its size is
        /// the same on every key press.
        /// </summary>
        void Place(IntPtr t)
        {
            Native.RECT g = GameArea();
            int gw = g.Right - g.Left, gh = g.Bottom - g.Top;
            double scale = 1.0;
            try { uint dpi = Native.GetDpiForWindow(t); if (dpi >= 96) scale = dpi / 96.0; } catch (Exception) { }
            int w = Math.Min(gw, (int)Math.Round(Math.Max(320, cfg.PriceWidth) * scale));
            int top = (int)Math.Round(gh * 0.02);
            int h = Math.Min(gh - 2 * top, (int)Math.Round(Math.Max(320, cfg.PriceHeight) * scale));
            int side = (int)Math.Round(gh * 370.0 / 600.0);
            Native.POINT cur;
            bool inventory = !Native.GetCursorPos(out cur) || cur.X >= g.Left + gw / 2;
            int x = inventory ? g.Right - side - w - 2 : g.Left + side + 2;
            x = Math.Max(g.Left, Math.Min(g.Right - w, x));
            panelRect.Left = x; panelRect.Top = g.Top + top; panelRect.Right = x + w; panelRect.Bottom = g.Top + top + h;
        }

        /// <summary>
        /// How high the browser's title bar is above the page: the inside of the window less the page's own height,
        /// which the page tells (the browser draws its title bar inside the window, there is nothing to ask Windows).
        /// True when the height is another than it was thought to be.
        /// </summary>
        bool Measure(IntPtr t)
        {
            long ps = Interlocked.Read(ref pageSize);
            Native.RECT c;
            if (ps == 0 || !Native.GetClientRect(t, out c)) return false;
            int pw = (int)(ps >> 32), ph = (int)(ps & 0xFFFFFFFF);
            int bar = (c.Bottom - c.Top) - ph;
            if (Math.Abs((c.Right - c.Left) - pw) > 2 || bar < 0 || bar > 200 || bar == titleBar) return false; // told at another size
            titleBar = bar;
            return true;
        }

        /// <summary>
        /// Put the page of the price check window on its rectangle of the screen and cut the rest of the window away:
        /// the browser's title bar above the page and the borders around it. With the frame go moving and resizing.
        /// </summary>
        void Fit(IntPtr t, bool show)
        {
            if (Native.IsIconic(t) || Native.IsZoomed(t)) Native.ShowWindow(t, 4); // SW_SHOWNOACTIVATE: a plain window again
            Native.RECT wr, c, box;
            Native.POINT o = new Native.POINT();
            if (!Native.GetWindowRect(t, out wr) || !Native.GetClientRect(t, out c) || !Native.ClientToScreen(t, ref o)) return;
            double scale = 1.0;
            try { uint dpi = Native.GetDpiForWindow(t); if (dpi >= 96) scale = dpi / 96.0; } catch (Exception) { }
            int bar = titleBar >= 0 ? titleBar : (int)Math.Round(31 * scale); // the usual one until the page has told its size
            // the page inside the window: below the title bar, within the borders for resizing
            int L = o.X - wr.Left, T = o.Y - wr.Top + bar, R = wr.Right - (o.X + c.Right), B = wr.Bottom - (o.Y + c.Bottom);
            int w = panelRect.Right - panelRect.Left, h = panelRect.Bottom - panelRect.Top;
            int nx = panelRect.Left - L, ny = panelRect.Top - T, nw = w + L + R, nh = h + T + B;
            bool sized = wr.Right - wr.Left != nw || wr.Bottom - wr.Top != nh;
            if (sized) Interlocked.Exchange(ref pageSize, 0); // told at the old size: the page tells its new one
            if (sized || wr.Left != nx || wr.Top != ny) Native.SetWindowPos(t, IntPtr.Zero, nx, ny, nw, nh, Native.SWP_NOACTIVATE | Native.SWP_NOZORDER);
            if (Native.GetWindowRgnBox(t, out box) == 0 || box.Left != L || box.Top != T || box.Right != L + w || box.Bottom != T + h)
            {
                IntPtr rgn = Native.CreateRectRgn(L, T, L + w, T + h);
                if (Native.SetWindowRgn(t, rgn, true) == 0) Native.DeleteObject(rgn); // taken over by Windows when it is set
            }
            if (!show) return;
            panelOn = true;
            if (!Native.IsWindowVisible(t)) Native.ShowWindow(t, 4); // SW_SHOWNOACTIVATE: the keyboard stays with the game
            Above(t);
        }

        /// <summary>
        /// The price check window over the game: shown where it belongs when a key press asks for it, without its frame
        /// and without the keyboard; put away when the page's close button asks, and when another program comes in front
        /// (Alt+Tab): it belongs to the game and is not to lie over other programs.
        /// </summary>
        void PanelTick()
        {
            long now = DateTime.UtcNow.Ticks;
            if (openAhead != 0 && now > openAhead) { openAhead = 0; EnsurePrice(); }
            long want = Interlocked.Read(ref panelWanted);
            IntPtr t = PriceWindow();
            if (t == IntPtr.Zero)
            {
                if (want < 0 || (want > 0 && now > want)) Interlocked.Exchange(ref panelWanted, 0);
                return; // not open, or still opening
            }
            if (t != priceReady) Prepare(t);
            if (want != 0) Interlocked.Exchange(ref panelWanted, 0);
            if (want < 0) { HidePanel(); return; }
            if (want > 0 && now <= want)
            {
                Measure(t);
                Place(t);
                Fit(t, true);
                away = 0;
                // a window that took the keyboard all the same (the browser opened it this moment): back to the game
                if (IsGame(gameWnd) && Native.GetForegroundWindow() == t) Native.Focus(gameWnd);
                return;
            }
            if (!Native.IsWindowVisible(t)) return;
            if (!panelOn) { Native.ShowWindow(t, 0); return; } // shown by the browser itself (as it opened): not asked for
            if (Measure(t)) Fit(t, false); // the page told its size: the cut follows the real title bar
            if (anyWindow) return;
            IntPtr fg = Native.GetForegroundWindow();
            bool with = fg == IntPtr.Zero || fg == t || IsGame(fg) || Native.GetWindow(fg, 4) == t; // 4: its owner (a list the page opened)
            away = with ? 0 : away + 1;
            if (away >= 2) { away = 0; HidePanel(); }
        }

        void HidePanel()
        {
            IntPtr t = PriceWindow();
            panelOn = false;
            if (t == IntPtr.Zero || !Native.IsWindowVisible(t)) return;
            // put away with its own button it has the keyboard: that goes back to the game, not to the next window in line
            if (Native.GetForegroundWindow() == t && IsGame(gameWnd) && !Native.IsIconic(gameWnd)) Native.Focus(gameWnd);
            Native.ShowWindow(t, 0); // SW_HIDE
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
                    Process.Start(edge, "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=" + size + " --no-first-run --no-default-browser-check --disable-features=Translate");
                }
                else Process.Start(url); // the default browser
            }
            catch (Exception e) { tray.ShowBalloonTip(6000, PAGE_TITLE, "The window could not be opened (" + e.Message + "). Open " + url + " in a browser.", ToolTipIcon.Warning); }
        }

        /// <summary>The assistant's window above the game without taking the keyboard from it.</summary>
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
            try { focus.Stop(); copy.Stop(); panel.Stop(); Native.RemoveClipboardFormatListener(win.Handle); if (registered) Native.UnregisterHotKey(win.Handle, 1); } catch (Exception) { }
            // the window goes with the program: without it the page has nothing to load from
            try
            {
                foreach (string title in new string[] { PRICE_TITLE, PAGE_TITLE })
                {
                    IntPtr h = Native.FindWindowByTitle(title, title == PRICE_TITLE);
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
