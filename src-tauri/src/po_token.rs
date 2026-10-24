// Mints YouTube proof-of-origin tokens (poTokens) on PC.
//
// YouTube only issues working tokens to BotGuard running on a youtube.com page.
// The app's own page is not one, so tokens minted there come back without the
// WebPO part and YouTube still answers "unplayable" for many songs. This opens a
// hidden window on youtube.com (a tiny page: robots.txt), runs the minting script
// there, and receives the result when the script navigates to
// http://frfpot.localhost/?r=<json>, a navigation that is cancelled and only
// carries the answer back. It mirrors NativePoTokenMinter.java on Android.
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{oneshot, Mutex};

const LABEL: &str = "potminter";
const RESULT_HOST: &str = "frfpot.localhost";
// The hidden window is a whole web page (about 30 MB). It is closed after this
// long without a request and opened again by the next one.
const IDLE_CLOSE: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
pub struct PotState {
    busy: Mutex<()>,
    pending: StdMutex<Option<oneshot::Sender<String>>>,
    ready: StdMutex<bool>,
    last_used: StdMutex<Option<Instant>>,
}

fn create_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    *app.state::<PotState>().ready.lock().unwrap() = false;
    let nav_app = app.clone();
    let url = "https://www.youtube.com/robots.txt".parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .visible(false)
        .skip_taskbar(true)
        .focused(false)
        // Must match the main window's WebView2 options (tauri.conf.json), or the
        // second webview cannot share the browser process.
        .additional_browser_args(
            "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows",
        )
        .on_navigation(move |url| {
            if url.host_str() != Some(RESULT_HOST) {
                return true;
            }
            let result = url
                .query_pairs()
                .find(|(k, _)| k == "r")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default();
            if let Some(tx) = nav_app.state::<PotState>().pending.lock().unwrap().take() {
                let _ = tx.send(result);
            }
            false // keep the page (and its warmed-up minter) where it is
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished
                && payload.url().host_str() == Some("www.youtube.com")
            {
                *window.app_handle().state::<PotState>().ready.lock().unwrap() = true;
            }
        })
        .build()
        .map_err(|e| e.to_string())
}

fn schedule_idle_close(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_CLOSE + Duration::from_secs(1)).await;
        let state = app.state::<PotState>();
        // Not while a request is running, and not if another one came in since.
        let Ok(_guard) = state.busy.try_lock() else { return };
        let idle = state
            .last_used
            .lock()
            .unwrap()
            .map_or(true, |t| t.elapsed() >= IDLE_CLOSE);
        if idle && app.get_webview_window(LABEL).is_some() {
            reset(&app);
        }
    });
}

fn reset(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
    *app.state::<PotState>().ready.lock().unwrap() = false;
}

/// Returns JSON: {ok, visitorData, contentPot, sessionPot} or {ok:false, error}.
#[tauri::command]
pub async fn mint_po_token(app: AppHandle, video_id: String) -> Result<String, String> {
    let state = app.state::<PotState>();
    let _one_at_a_time = state.busy.lock().await;

    let window = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => create_window(&app)?,
    };

    // Wait for the youtube.com page (first use only).
    let mut waited = 0;
    while !*state.ready.lock().unwrap() {
        if waited >= 15000 {
            reset(&app);
            return Err("youtube page did not load".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        waited += 100;
    }

    let (tx, rx) = oneshot::channel();
    *state.pending.lock().unwrap() = Some(tx);
    *state.last_used.lock().unwrap() = Some(Instant::now());
    schedule_idle_close(&app);
    let binding = serde_json::to_string(&video_id).map_err(|e| e.to_string())?;
    window
        .eval(&MINT_SCRIPT.replace("__VIDEO_ID__", &binding))
        .map_err(|e| e.to_string())?;

    match tokio::time::timeout(Duration::from_secs(20), rx).await {
        Ok(Ok(json)) => Ok(json),
        _ => {
            state.pending.lock().unwrap().take();
            // A wedged VM must not poison later requests: rebuild from scratch.
            reset(&app);
            Err("poToken mint timed out".into())
        }
    }
}

// Runs on the youtube.com robots.txt page, so att/get and GenerateIT are plain
// same-origin fetches. Same flow as the Android minter.
const MINT_SCRIPT: &str = r#"
(async () => {
  const send = (obj) => {
    location.href = 'http://frfpot.localhost/?r=' + encodeURIComponent(JSON.stringify(obj));
  };
  try {
    if (!window.__frfPotMinter) {
      const YT_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
      const GOOG_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
      const REQ_KEY = 'O43z0dpjhgX20SCx4KAo';
      const post = async (url, body, headers) => {
        const res = await fetch(url, {method: 'POST', headers: headers, body: JSON.stringify(body)});
        return res.json();
      };
      const att = await post(
        'https://www.youtube.com/youtubei/v1/att/get?key=' + YT_KEY + '&prettyPrint=false',
        {context: {client: {clientName: 'WEB', clientVersion: '2.20260617.01.00', hl: 'en', gl: 'US'}},
         engagementType: 'ENGAGEMENT_TYPE_UNBOUND'});
      const bg = att.bgChallenge;
      if (!bg || !bg.program) throw new Error('no challenge');
      const visitorData = att.responseContext && att.responseContext.visitorData;
      if (!window.yt) window.yt = {config_: {}};
      const scriptUrl = bg.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
      const fullUrl = scriptUrl.indexOf('http') === 0 ? scriptUrl : 'https:' + scriptUrl;
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = fullUrl;
        s.onload = () => res(null);
        s.onerror = () => rej(new Error('interpreter load failed'));
        document.head.appendChild(s);
      });
      const vm = window[bg.globalName];
      if (!vm || !vm.a) throw new Error('no vm');
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
        {'Content-Type': 'application/json+protobuf',
         'x-goog-api-key': GOOG_KEY, 'x-user-agent': 'grpc-web-javascript/0.1'});
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
        visitorData: visitorData
      };
    }
    const m = window.__frfPotMinter;
    const contentPot = await m.mint(__VIDEO_ID__);
    // The session token depends only on the visitor, so it is minted once and
    // reused: the app keeps one YouTube session per session token, and a new
    // token every song would rebuild that session (and its player script) each time.
    if (!m.sessionPot) m.sessionPot = await m.mint(m.visitorData);
    const sessionPot = m.sessionPot;
    send({ok: true, visitorData: m.visitorData, contentPot: contentPot, sessionPot: sessionPot});
  } catch (e) {
    window.__frfPotMinter = null;
    send({ok: false, error: String(e && e.message ? e.message : e)});
  }
})();
"#;
