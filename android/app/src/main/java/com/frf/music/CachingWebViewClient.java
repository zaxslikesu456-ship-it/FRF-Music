package com.frf.music;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves song and artist pictures from a permanent on-disk cache. The web
 * view's own HTTP cache is small and gets cleared, so without this a picture
 * that is not in it (first launch offline, after a cache cleanup, after the
 * system trims storage) is blank. Anything seen once online stays available.
 * Requests that are not pictures from the known image hosts, and any miss that
 * cannot be fetched, fall through to the normal web view behavior.
 */
final class CachingWebViewClient extends BridgeWebViewClient {
    private final Context context;

    CachingWebViewClient(Bridge bridge, Context context) {
        super(bridge);
        this.context = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse cached = cachedImage(request);
        return cached != null ? cached : super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse cachedImage(WebResourceRequest request) {
        try {
            if (!"GET".equals(request.getMethod())) return null;
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
            if (!CoverCache.isImageHost(uri.getHost())) return null;

            File file = CoverCache.ensureFile(context, uri.toString());
            if (file == null) return null;

            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "max-age=86400");
            return new WebResourceResponse(
                    CoverCache.mimeOf(file), null, 200, "OK", headers, new FileInputStream(file));
        } catch (Exception e) {
            return null;
        }
    }
}
