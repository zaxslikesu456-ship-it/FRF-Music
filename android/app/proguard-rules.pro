# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---- FRF Music (code shrinking for the release APK) ----
# The app's own classes: plugins and their @PluginMethod methods are called by
# name from the web layer, and the token minter's @JavascriptInterface from
# its page. The app's code is small, so it is kept whole.
-keep class com.frf.music.** { *; }
# Capacitor finds plugins and methods by reflection.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public <methods>; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
# Cronet loads its implementation by class name.
-keep class org.chromium.net.** { *; }
-dontwarn org.chromium.**
