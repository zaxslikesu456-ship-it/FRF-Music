package com.frf.music;

import android.net.Uri;

import androidx.annotation.Nullable;

import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.upstream.BaseDataSource;
import com.google.android.exoplayer2.upstream.DataSource;
import com.google.android.exoplayer2.upstream.DataSpec;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * googlevideo throttles a single open-ended GET to a few KB/s after the first
 * burst, which makes ExoPlayer stall every few seconds. It serves full speed
 * when the byte window is given as a {@code range=start-end} query parameter,
 * which is how yt-dlp and our Cronet downloader fetch it. This wraps a normal
 * HTTP data source and reads googlevideo URLs as a sequence of such chunks;
 * every other URL passes straight through.
 */
final class GoogleVideoChunkedDataSource extends BaseDataSource {
    private static final long CHUNK_BYTES = 1024L * 1024L;

    private final DataSource upstream;

    private DataSpec spec;
    private Uri uri;
    private boolean chunked;
    private boolean opened;
    private boolean upstreamOpen;
    // Absolute offset of the next byte to request, and the exclusive end of the
    // data the caller wants (C.LENGTH_UNSET when the total size is unknown).
    private long nextPos;
    private long endPos;
    private long chunkGot;

    GoogleVideoChunkedDataSource(DataSource upstream) {
        super(/* isNetwork= */ true);
        this.upstream = upstream;
    }

    private static boolean isGoogleVideo(Uri u) {
        String host = u.getHost();
        return host != null && host.endsWith("googlevideo.com") && u.getQueryParameter("range") == null;
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        spec = dataSpec;
        uri = dataSpec.uri;
        transferInitializing(dataSpec);
        chunked = isGoogleVideo(uri);
        if (!chunked) {
            long length = upstream.open(dataSpec);
            upstreamOpen = true;
            opened = true;
            transferStarted(dataSpec);
            return length;
        }

        long clen = -1;
        try {
            String raw = uri.getQueryParameter("clen");
            if (raw != null) clen = Long.parseLong(raw);
        } catch (NumberFormatException ignored) {}

        nextPos = dataSpec.position;
        if (dataSpec.length != C.LENGTH_UNSET) {
            endPos = nextPos + dataSpec.length;
        } else {
            endPos = clen > 0 ? clen : C.LENGTH_UNSET;
        }
        openNextChunk();
        opened = true;
        transferStarted(dataSpec);
        return endPos == C.LENGTH_UNSET ? C.LENGTH_UNSET : endPos - dataSpec.position;
    }

    private void openNextChunk() throws IOException {
        long end = nextPos + CHUNK_BYTES;
        if (endPos != C.LENGTH_UNSET) end = Math.min(end, endPos);
        Uri chunkUri = uri.buildUpon()
                .appendQueryParameter("range", nextPos + "-" + (end - 1))
                .build();
        // The window is in the URL, so no HTTP Range header: position 0 and an
        // unset length make the upstream source send a plain GET.
        DataSpec chunkSpec = spec.buildUpon()
                .setUri(chunkUri)
                .setPosition(0)
                .setLength(C.LENGTH_UNSET)
                .build();
        chunkGot = 0;
        upstream.open(chunkSpec);
        upstreamOpen = true;
    }

    private void closeUpstream() throws IOException {
        if (upstreamOpen) {
            upstreamOpen = false;
            upstream.close();
        }
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        if (length == 0) return 0;
        if (!chunked) {
            int read = upstream.read(buffer, offset, length);
            if (read != C.RESULT_END_OF_INPUT) bytesTransferred(read);
            return read;
        }
        while (true) {
            if (!upstreamOpen) {
                if (endPos != C.LENGTH_UNSET && nextPos >= endPos) return C.RESULT_END_OF_INPUT;
                openNextChunk();
            }
            int read = upstream.read(buffer, offset, length);
            if (read == C.RESULT_END_OF_INPUT) {
                boolean shortChunk = chunkGot < CHUNK_BYTES;
                boolean empty = chunkGot == 0;
                closeUpstream();
                // An empty chunk would loop forever; a short one with no known
                // total size is the end of the media.
                if (empty || (endPos == C.LENGTH_UNSET && shortChunk)) return C.RESULT_END_OF_INPUT;
                continue;
            }
            nextPos += read;
            chunkGot += read;
            bytesTransferred(read);
            return read;
        }
    }

    @Nullable
    @Override
    public Uri getUri() {
        return uri;
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return upstreamOpen ? upstream.getResponseHeaders() : Collections.emptyMap();
    }

    @Override
    public void close() throws IOException {
        try {
            closeUpstream();
        } finally {
            if (opened) {
                opened = false;
                transferEnded();
            }
        }
    }
}
