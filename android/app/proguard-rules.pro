# Methods called from JavaScript keep their names.
-keepclassmembers class br.com.gestaoculturalpro.pdf.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
# The PDF writer reaches the package-private print callbacks by name.
-keep class android.print.PdfPrinter { *; }
