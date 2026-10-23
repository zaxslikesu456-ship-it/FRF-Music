package com.frf.music;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * A Capacitor WebView that never reports itself hidden to the renderer.
 *
 * When the Activity is stopped the framework pushes window/view visibility
 * GONE into the WebView, Blink marks the page hidden, and the embedded YouTube
 * player pauses itself on the resulting visibilitychange event. Native ExoPlayer
 * was meant to take over at that point, but Google answers its direct
 * googlevideo fetches with HTTP 403, so the handover yields silence.
 *
 * The WebView's own Chromium network stack is NOT flagged (foreground audio
 * proves it), so the reliable path is to keep that engine audible in the
 * background. Pinning visibility here stops the "hidden" event from ever
 * reaching Blink, so playback never pauses when the app is backgrounded or the
 * screen turns off, while PlaybackService still owns the notification and
 * lock-screen controls.
 *
 * Extending CapacitorWebView (rather than WebView) keeps Bridge's
 * `instanceof CapacitorWebView` handling — input capture and bridge wiring —
 * intact.
 */
public class PlaybackCapacitorWebView extends CapacitorWebView {

    public PlaybackCapacitorWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public void onWindowVisibilityChanged(int visibility) {
        // Always tell the renderer the window is visible.
        super.onWindowVisibilityChanged(View.VISIBLE);
    }

    @Override
    public void onVisibilityChanged(View changedView, int visibility) {
        super.onVisibilityChanged(changedView, View.VISIBLE);
    }

    @Override
    public void onVisibilityAggregated(boolean isVisible) {
        // API 24+ path Chromium uses to derive page visibility: force "visible".
        super.onVisibilityAggregated(true);
    }
}
