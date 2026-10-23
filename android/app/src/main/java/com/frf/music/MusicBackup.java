package com.frf.music;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A second copy of every download in the phone's shared Music folder
 * (Music/FRF Music). The app's own storage is wiped when the app is
 * uninstalled, so that copy is what lets downloads survive a reinstall.
 *
 * File names are "Artist - Title [youtubeId].ext". The id says which song a file
 * is, and the name carries the title and artist because Android's media scanner
 * re-reads the file and overwrites any title/artist stored in the media database. Writing needs no permission on Android 10+; reading the files back
 * after a reinstall needs the audio permission, because the new install no
 * longer owns them.
 */
final class MusicBackup {
    static final String FOLDER = "Music/FRF Music/";
    private static final Pattern ID_IN_NAME =
            Pattern.compile("\\[([A-Za-z0-9_-]{11})\\]\\.[A-Za-z0-9]+$");

    private MusicBackup() {}

    static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    static final class Item {
        String uri;
        String name;
        String title;
        String artist;
        long durationMs;
        long size;
        String youtubeId;
    }

    private static String clean(String text, int max) {
        String c = text == null ? "" : text.replaceAll("[\\\\/:*?\"<>|\\[\\]]", " ").replaceAll("\\s+", " ").trim();
        return c.length() > max ? c.substring(0, max).trim() : c;
    }

    static String displayName(String title, String artist, String youtubeId, String ext) {
        String t = clean(title, 80);
        if (t.isEmpty()) t = "Song";
        String a = clean(artist, 40);
        return (a.isEmpty() ? "" : a + " - ") + t + " [" + youtubeId + "]." + ext;
    }

    private static Uri collection() {
        return MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
    }

    /** The uri of an existing copy of this song, or null. */
    static Uri findById(Context context, String youtubeId) {
        if (!supported()) return null;
        String[] cols = {MediaStore.Audio.Media._ID};
        String sel = MediaStore.MediaColumns.RELATIVE_PATH + "=? AND "
                + MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?";
        String[] args = {FOLDER, "%[" + youtubeId + "].%"};
        try (Cursor c = context.getContentResolver().query(collection(), cols, sel, args, null)) {
            if (c != null && c.moveToFirst()) {
                return ContentUris.withAppendedId(collection(), c.getLong(0));
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Copies a private file into the Music folder; true if a copy exists afterwards. */
    static boolean export(Context context, File src, String title, String artist,
                          String youtubeId, String ext) {
        if (!supported() || src == null || !src.exists() || youtubeId == null) return false;
        Uri existing = findById(context, youtubeId);
        if (existing != null) {
            // Copies made by older versions have no artist in the name; bring them
            // up to the current "Artist - Title [id]" form (this install owns them).
            try {
                ContentValues rename = new ContentValues();
                rename.put(MediaStore.Audio.Media.DISPLAY_NAME, displayName(title, artist, youtubeId, ext));
                context.getContentResolver().update(existing, rename, null, null);
            } catch (Exception ignored) {}
            return true;
        }

        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, displayName(title, artist, youtubeId, ext));
        values.put(MediaStore.Audio.Media.MIME_TYPE, mimeFor(ext));
        values.put(MediaStore.Audio.Media.RELATIVE_PATH, FOLDER);
        values.put(MediaStore.Audio.Media.TITLE, title);
        values.put(MediaStore.Audio.Media.ARTIST, artist);
        values.put(MediaStore.Audio.Media.ALBUM, "FRF Music");
        values.put(MediaStore.Audio.Media.IS_PENDING, 1);

        Uri uri = null;
        try {
            uri = resolver.insert(collection(), values);
            if (uri == null) return false;
            try (InputStream in = new FileInputStream(src);
                 OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new java.io.IOException("no output stream");
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Audio.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return true;
        } catch (Exception e) {
            if (uri != null) {
                try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
            }
            return false;
        }
    }

    /** Removes the copy of a song (only possible while this install still owns it). */
    static boolean delete(Context context, String youtubeId) {
        Uri uri = findById(context, youtubeId);
        if (uri == null) return false;
        try {
            return context.getContentResolver().delete(uri, null, null) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Every song copy in the Music/FRF Music folder. Needs the audio permission after a reinstall. */
    static List<Item> list(Context context) {
        List<Item> items = new ArrayList<>();
        if (!supported()) return items;
        String[] cols = {
                MediaStore.Audio.Media._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.DURATION,
                MediaStore.MediaColumns.SIZE,
        };
        String sel = MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        try (Cursor c = context.getContentResolver()
                .query(collection(), cols, sel, new String[] {FOLDER}, null)) {
            if (c == null) return items;
            while (c.moveToNext()) {
                String name = c.getString(1);
                Matcher m = name == null ? null : ID_IN_NAME.matcher(name);
                if (m == null || !m.find()) continue; // not one of ours
                Item it = new Item();
                it.uri = ContentUris.withAppendedId(collection(), c.getLong(0)).toString();
                it.name = name;
                it.title = c.getString(2);
                it.artist = c.getString(3);
                it.durationMs = c.getLong(4);
                it.size = c.getLong(5);
                it.youtubeId = m.group(1);
                items.add(it);
            }
        } catch (Exception ignored) {}
        return items;
    }

    /** Copies a Music-folder file back into the app's private storage. */
    static boolean restore(Context context, Uri uri, File dest) {
        try (InputStream in = context.getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) return false;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return dest.length() > 0;
        } catch (Exception e) {
            dest.delete();
            return false;
        }
    }

    private static String mimeFor(String ext) {
        switch (ext.toLowerCase()) {
            case "webm": return "audio/webm";
            case "ogg": return "audio/ogg";
            default: return "audio/mp4";
        }
    }
}
