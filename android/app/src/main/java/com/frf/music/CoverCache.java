package com.frf.music;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.Comparator;

/**
 * On-disk cover art, so the media notification and lock screen can show a
 * song's picture with no network. A cover is saved the first time it is
 * fetched and when a song is downloaded.
 */
final class CoverCache {
    private static final int MAX_FILES = 1500;
    private static final int MAX_BYTES = 4 * 1024 * 1024;

    private CoverCache() {}

    static boolean isImageHost(String host) {
        return host != null
                && (host.endsWith("ytimg.com")
                || host.endsWith("googleusercontent.com")
                || host.endsWith("ggpht.com"));
    }

    private static File fileFor(Context context, String url) {
        File dir = new File(context.getFilesDir(), "covers");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, Integer.toHexString(url.hashCode()) + "_" + url.length() + ".img");
    }

    /** The cached file for a picture, fetching and saving it if needed. Blocking; null if unavailable. */
    static File ensureFile(Context context, String url) {
        if (url == null || url.isEmpty()) return null;
        File file = fileFor(context, url);
        if (file.exists() && file.length() > 0) {
            file.setLastModified(System.currentTimeMillis());
            return file;
        }
        byte[] data = download(url);
        if (data == null || !looksLikeImage(data)) return null;
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(data);
        } catch (Exception e) {
            file.delete();
            return null;
        }
        prune(context);
        return file;
    }

    /** Cached bitmap if present, otherwise fetch it (and cache it). Blocking. */
    static Bitmap load(Context context, String url) {
        File file = ensureFile(context, url);
        if (file == null) return null;
        Bitmap bmp = BitmapFactory.decodeFile(file.getPath());
        if (bmp == null) file.delete();
        return bmp;
    }

    /** Make sure a cover is on disk; returns whether it is. Blocking. */
    static boolean ensure(Context context, String url) {
        return ensureFile(context, url) != null;
    }

    static String mimeOf(File file) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(file)) {
            byte[] head = new byte[12];
            int n = in.read(head);
            if (n >= 3 && (head[0] & 0xFF) == 0xFF && (head[1] & 0xFF) == 0xD8) return "image/jpeg";
            if (n >= 4 && (head[0] & 0xFF) == 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G') return "image/png";
            if (n >= 12 && head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                    && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P') return "image/webp";
            if (n >= 3 && head[0] == 'G' && head[1] == 'I' && head[2] == 'F') return "image/gif";
        } catch (Exception ignored) {}
        return "image/jpeg";
    }

    // Never cache an HTML error page or anything else that is not a picture.
    private static boolean looksLikeImage(byte[] data) {
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, opts);
        return opts.outWidth > 0 && opts.outHeight > 0;
    }

    private static byte[] download(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            if (conn.getResponseCode() / 100 != 2) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > MAX_BYTES) return null;
                }
                return buf.toByteArray();
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void prune(Context context) {
        File[] files = new File(context.getFilesDir(), "covers").listFiles();
        if (files == null || files.length <= MAX_FILES) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (int i = 0; i < files.length - MAX_FILES; i++) files[i].delete();
    }
}
