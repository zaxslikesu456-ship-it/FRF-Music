package com.frf.music;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * Mints YouTube WebPO (proof-of-origin) tokens inside a hidden WebView that
 * runs on a real youtube.com origin.
 *
 * The BotGuard VM silently skips its WebPO stage when it is not running on a
 * YouTube origin — webPoSignalOutput stays empty and GenerateIT answers with
 * the legacy fallback instead of an integrity token. This app's WebView is
 * https://localhost, so JS-side minting can never produce a usable token.
 * The hidden WebView loads youtube.com/robots.txt (tiny page, real origin)
 * and the VM, attestation and minting all run there through the page's own
 * fetch, which is same-origin to YouTube.
 *
 * The WebView and the minted callback are kept alive between requests; only
 * the per-video content binding needs a follow-up evaluation afterwards.
 */
public class NativePoTokenMinter {

    public interface MintCallback {
        void onResult(String json);
    }

    private static final NativePoTokenMinter INSTANCE = new NativePoTokenMinter();

    public static NativePoTokenMinter get() {
        return INSTANCE;
    }

    private static final long INIT_TIMEOUT_MS = 30_000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private WebView webView;
    private boolean pageReady = false;
    private boolean busy = false;
    private String pendingVideoId;
    private MintCallback pendingCallback;
    private final Runnable timeoutRunnable = this::onTimeout;

    private NativePoTokenMinter() {}

    /**
     * Called from Capacitor's worker thread. Exactly one request is handled at
     * a time; concurrent callers are rejected so the JS layer can fall back.
     */
    public synchronized void mint(Context context, String videoId, MintCallback callback) {
        if (busy) {
            callback.onResult(null);
            return;
        }
        busy = true;
        pendingVideoId = videoId;
        pendingCallback = callback;
        mainHandler.postDelayed(timeoutRunnable, INIT_TIMEOUT_MS);
        if (webView == null) {
            mainHandler.post(() -> createWebView(context.getApplicationContext()));
        } else if (pageReady) {
            runInit();
        }
        // else: WebView exists but the page has not finished loading yet; the
        // WebViewClient picks the request up in onPageFinished.
    }

    private void onTimeout() {
        deliver(null);
        // A wedged VM must not poison later requests: rebuild from scratch.
        mainHandler.post(() -> {
            if (webView != null) {
                webView.destroy();
                webView = null;
            }
            pageReady = false;
        });
    }

    private void deliver(String json) {
        mainHandler.removeCallbacks(timeoutRunnable);
        busy = false;
        MintCallback cb = pendingCallback;
        pendingCallback = null;
        if (cb != null) cb.onResult(json);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView(Context appContext) {
        webView = new WebView(appContext);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(false);
        webView.addJavascriptInterface(new PotBridge(), "NativePotBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                runInit();
            }
        });
        // A tiny page on the genuine origin; the mint script supplies the
        // window.yt config the BotGuard program expects.
        webView.loadUrl("https://www.youtube.com/robots.txt");
    }

    private void runInit() {
        if (webView == null || pendingVideoId == null) return;
        String binding = JSONObject.quote(pendingVideoId);
        mainHandler.post(() -> {
            if (webView == null) return;
            webView.evaluateJavascript(MINT_SCRIPT.replace("__VIDEO_ID__", binding), null);
        });
    }

    private class PotBridge {
        @JavascriptInterface
        public void onResult(String json) {
            android.util.Log.d("FRFPlayback", "poToken mint result: "
                    + (json != null && json.length() > 180 ? json.substring(0, 180) + "…" : json));
            if (json == null || json.isEmpty()) {
                deliver(null);
                return;
            }
            try {
                JSONObject obj = new JSONObject(json);
                if (!obj.optBoolean("ok", false)) {
                    // Mint failed inside the page: drop the cached VM so the
                    // next attempt re-initializes instead of reusing a broken
                    // interpreter state.
                    mainHandler.post(() -> {
                        if (webView != null) {
                            webView.evaluateJavascript("window.__frfPotMinter = null;", null);
                        }
                    });
                }
                deliver(obj.toString());
            } catch (Exception e) {
                deliver(null);
            }
        }
    }

    /**
     * Runs on the youtube.com robots.txt page. Everything is same-origin to
     * YouTube here: att/get, the interpreter script and GenerateIT are plain
     * page fetches. Backslashes are avoided in this script because it is
     * embedded in a Java text block.
     */
    private static final String MINT_SCRIPT = """
            (async () => {
              const fail = (err) => {
                try { NativePotBridge.onResult(JSON.stringify({ok:false, error:String(err)})); } catch (e) {}
              };
              try {
                if (!window.__frfPotMinter) {
                  const YT_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
                  const GOOG_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
                  const REQ_KEY = 'O43z0dpjhgX20SCx4KAo';
                  const post = async (url, body, headers) => {
                    const res = await fetch(url, {method:'POST', headers: headers, body: JSON.stringify(body)});
                    return res.json();
                  };
                  const att = await post(
                    'https://www.youtube.com/youtubei/v1/att/get?key=' + YT_KEY + '&prettyPrint=false',
                    {context:{client:{clientName:'WEB',clientVersion:'2.20260617.01.00',hl:'en',gl:'US'}},
                     engagementType:'ENGAGEMENT_TYPE_UNBOUND'});
                  const bg = att.bgChallenge;
                  if (!bg || !bg.program) throw new Error('no challenge');
                  const visitorData = att.responseContext && att.responseContext.visitorData;
                  if (!window.yt) window.yt = {config_: {}};
                  const scriptUrl = bg.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
                  const fullUrl = scriptUrl.indexOf('http') === 0 ? scriptUrl : 'https:' + scriptUrl;
                  // A classic script tag, not fetch(): the interpreter lives on
                  // google.com, which serves no CORS header, and script tags
                  // are exempt from CORS.
                  await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = fullUrl;
                    s.onload = () => res(null);
                    s.onerror = () => rej(new Error('interpreter load failed'));
                    document.head.appendChild(s);
                  });
                  const vm = window[bg.globalName];
                  if (!vm || !vm.a) throw new Error('no vm');
                  // The setup callback can fire after vm.a's own promise
                  // settles, so wait on the callback itself, bounded.
                  let fnsResolve = null;
                  const fnsPromise = new Promise((res) => { fnsResolve = res; });
                  await vm.a(bg.program, (a) => { fnsResolve({snap: a}); }, true, undefined,
                    () => {}, [[], []], undefined, false,
                    [() => {}, () => {}, () => {}, () => {}, () => {}])?.[0];
                  const fns = await Promise.race([
                    fnsPromise,
                    new Promise((res, rej) => setTimeout(() => rej(new Error('vm init timeout')), 8000))
                  ]);
                  if (!fns || !fns.snap) throw new Error('no snapshot fn');
                  const out = [];
                  const bgResp = await new Promise((res) => fns.snap((r) => res(r),
                    [undefined, undefined, out, undefined]));
                  if (!out.length) throw new Error('no webpo signals');
                  const it = await post('https://www.youtube.com/api/jnn/v1/GenerateIT',
                    [REQ_KEY, bgResp],
                    {'Content-Type':'application/json+protobuf',
                     'x-goog-api-key':GOOG_KEY, 'x-user-agent':'grpc-web-javascript/0.1'});
                  if (!it[0]) throw new Error('no integrity token');
                  const b64u8 = (s) => {
                    const b = atob(s.split('-').join('+').split('_').join('/'));
                    const a = new Uint8Array(b.length);
                    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                    return a;
                  };
                  const u8b64 = (u8) => {
                    let bin = '';
                    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
                    return btoa(bin).split('+').join('-').split('/').join('_').replace(/=+$/, '');
                  };
                  const mintCallback = await out[0](b64u8(it[0]));
                  window.__frfPotMinter = {
                    mint: async (binding) => u8b64(await mintCallback(new TextEncoder().encode(binding))),
                    visitorData: visitorData,
                    mintedAt: Date.now()
                  };
                }
                const m = window.__frfPotMinter;
                if (!m) throw new Error('minter unavailable');
                const contentPot = await m.mint(__VIDEO_ID__);
                const sessionPot = await m.mint(m.visitorData);
                NativePotBridge.onResult(JSON.stringify({
                  ok: true, visitorData: m.visitorData,
                  contentPot: contentPot, sessionPot: sessionPot
                }));
              } catch (e) {
                window.__frfPotMinter = null;
                fail(e && e.message ? e.message : e);
              }
            })();
            """;
}
