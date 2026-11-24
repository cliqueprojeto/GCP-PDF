package br.com.gestaoculturalpro.pdf

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.LocaleList
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * What the shared engine and interface may ask of Android. Synchronous calls answer with a JSON envelope
 * `{"ok":true,"v":…}` or `{"ok":false,"e":"…"}`; long requests answer later through `receive` with their id.
 */
class NativeBridge(private val activity: MainActivity) {
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newCachedThreadPool()
    private val files get() = activity.files
    private val processes = EngineProcesses(activity) { id, kind, data ->
        send(JSONObject().put("type", "proc").put("id", id).put("kind", kind).put("data", data))
    }
    private val html by lazy { HtmlPdfRenderer(activity, activity.loader) }
    private var printView: WebView? = null

    private fun send(message: JSONObject) {
        val script = "window.__gcpNative&&window.__gcpNative.receive(${JSONObject.quote(message.toString())})"
        main.post { if (!activity.isDestroyed) activity.webView.evaluateJavascript(script, null) }
    }

    fun emit(name: String, value: JSONObject) = send(JSONObject().put("type", "event").put("name", name).put("value", value))

    private fun resolve(id: Int, value: Any?) = send(JSONObject().put("type", "resolve").put("id", id).put("ok", true).put("v", value ?: JSONObject.NULL))
    private fun reject(id: Int, error: Throwable) = send(JSONObject().put("type", "resolve").put("id", id).put("ok", false).put("e", error.message ?: error.toString()))

    private inline fun envelope(block: () -> Any?): String = try {
        JSONObject().put("ok", true).put("v", block() ?: JSONObject.NULL).toString()
    } catch (error: Throwable) {
        JSONObject().put("ok", false).put("e", error.message ?: error.toString()).toString()
    }

    fun dispose() { processes.killAll(); pool.shutdownNow() }

    // ---------- environment ----------

    @JavascriptInterface
    fun info(): String = envelope {
        val pm = activity.packageManager
        val version = pm.getPackageInfo(activity.packageName, 0).versionName
        val locales = LocaleList.getDefault().let { list -> JSONArray((0 until list.size()).map { list[it].toLanguageTag() }) }
        val webView = WebView.getCurrentWebViewPackage()
        JSONObject()
            .put("files", activity.filesDir.path).put("cache", activity.cacheDir.path)
            .put("version", version).put("sdk", Build.VERSION.SDK_INT).put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
            .put("locales", locales).put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("webView", webView?.versionName ?: "").put("dark", (activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES)
            .put("tablet", activity.resources.configuration.smallestScreenWidthDp >= 600)
            .put("engine", File(activity.applicationInfo.nativeLibraryDir, "libpdfcraft.so").isFile)
    }

    @JavascriptInterface fun ready(): String = envelope { activity.markReady(); null }
    @JavascriptInterface fun chrome(dark: Boolean): String = envelope { activity.setChrome(dark); null }
    @JavascriptInterface fun launches(): String = envelope { activity.consumeLaunches() }
    @JavascriptInterface fun exit(): String = envelope { main.post { activity.moveTaskToBack(true) }; null }

    @JavascriptInterface
    fun copyText(text: String): String = envelope {
        main.post { (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("GCP-PDF", text)) }; null
    }

    @JavascriptInterface fun encrypt(text: String): String = envelope { SecretStore.encrypt(text) }
    @JavascriptInterface fun decrypt(text: String): String = envelope { SecretStore.decrypt(text) }

    // ---------- file system ----------

    @JavascriptInterface fun fsStat(path: String): String = envelope { files.stat(path) }
    @JavascriptInterface fun fsReaddir(path: String): String = envelope { files.readdir(path) }
    @JavascriptInterface fun fsRealpath(path: String): String = envelope { files.realpath(path) }
    @JavascriptInterface fun fsMkdir(path: String, recursive: Boolean): String = envelope { files.mkdir(path, recursive); null }
    @JavascriptInterface fun fsRm(path: String, recursive: Boolean, force: Boolean): String = envelope { files.rm(path, recursive, force); null }
    @JavascriptInterface fun fsRename(from: String, to: String): String = envelope { files.rename(from, to); null }
    @JavascriptInterface fun fsCopy(from: String, to: String): String = envelope { files.copy(from, to); null }
    @JavascriptInterface fun fsReadRange(path: String, offset: Double, length: Int): String = envelope { Base64.encodeToString(files.readRange(path, offset.toLong(), length), Base64.NO_WRAP) }
    @JavascriptInterface fun fsBegin(path: String, flag: String): String = envelope { files.beginWrite(path, flag) }
    @JavascriptInterface fun fsChunk(id: Int, base64: String): String = envelope { files.writeChunk(id, Base64.decode(base64, Base64.NO_WRAP)); null }
    @JavascriptInterface fun fsEnd(id: Int, abort: Boolean): String = envelope { files.endWrite(id, abort); null }

    // ---------- engine processes ----------

    @JavascriptInterface
    fun procStart(id: Int, command: String, args: String, cwd: String?): String = envelope {
        val list = JSONArray(args).let { array -> (0 until array.length()).map { array.getString(it) } }
        processes.start(id, command, list, cwd?.takeIf { it.isNotEmpty() }); null
    }
    @JavascriptInterface fun procWrite(id: Int, text: String): String = envelope { processes.write(id, text); null }
    @JavascriptInterface fun procEnd(id: Int): String = envelope { processes.closeInput(id); null }
    @JavascriptInterface fun procKill(id: Int): String = envelope { processes.kill(id); null }

    // ---------- long requests ----------

    @JavascriptInterface
    fun request(id: Int, method: String, payload: String) {
        val input = try { JSONObject(payload) } catch (error: Exception) { reject(id, error); return }
        try {
            when (method) {
                "open" -> openDocuments(id, input)
                "save" -> saveDocument(id, input)
                "folder" -> chooseFolder(id)
                "camera" -> capture(id, input)
                "html-pdf" -> htmlToPdf(id, input)
                "print" -> print(id, input)
                "share" -> pool.execute { try { activity.share(input.getJSONArray("paths").let { a -> (0 until a.length()).map { a.getString(it) } }, input.optString("mime", "application/pdf"), input.optString("title", "Compartilhar")); resolve(id, true) } catch (e: Exception) { reject(id, e) } }
                "external" -> { activity.openExternal(Uri.parse(input.getString("url"))); resolve(id, true) }
                "fetch" -> pool.execute { try { resolve(id, fetch(input)) } catch (e: Exception) { reject(id, e) } }
                "download" -> pool.execute { try { resolve(id, download(id, input)) } catch (e: Exception) { reject(id, e) } }
                "install" -> resolve(id, activity.installPackage(File(input.getString("path"))))
                else -> reject(id, IllegalArgumentException("Pedido desconhecido: $method"))
            }
        } catch (error: Exception) { reject(id, error) }
    }

    private fun persist(uri: Uri, write: Boolean) {
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or (if (write) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
        try { activity.contentResolver.takePersistableUriPermission(uri, flags) } catch (_: Exception) {
            try { activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { }
        }
    }

    private fun mimeTypes(input: JSONObject): Array<String> {
        val types = input.optJSONArray("mimes") ?: return arrayOf("*/*")
        return (0 until types.length()).map { types.getString(it) }.distinct().toTypedArray().ifEmpty { arrayOf("*/*") }
    }

    private fun openDocuments(id: Int, input: JSONObject) = main.post {
        val multiple = input.optBoolean("multiple")
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            .putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes(input))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if (!activity.launch(intent) { result ->
            pool.execute {
                try {
                    val data = result.data
                    val uris = if (result.resultCode != Activity.RESULT_OK || data == null) emptyList()
                        else data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } } ?: listOfNotNull(data.data)
                    uris.forEach { persist(it, true) }
                    resolve(id, JSONArray(uris.map { files.documentPath(it) }))
                } catch (e: Exception) { reject(id, e) }
            }
        }) reject(id, IllegalStateException("Nenhum aplicativo de arquivos disponível."))
    }

    private fun saveDocument(id: Int, input: JSONObject) = main.post {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(input.optString("mime", "application/octet-stream"))
            .putExtra(Intent.EXTRA_TITLE, input.optString("name", "documento"))
        if (!activity.launch(intent) { result ->
            pool.execute {
                try {
                    val uri = result.data?.data
                    if (result.resultCode != Activity.RESULT_OK || uri == null) resolve(id, null)
                    else { persist(uri, true); resolve(id, files.documentPath(uri, input.optString("name"))) }
                } catch (e: Exception) { reject(id, e) }
            }
        }) reject(id, IllegalStateException("Nenhum aplicativo de arquivos disponível."))
    }

    private fun chooseFolder(id: Int) = main.post {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if (!activity.launch(intent) { result ->
            val uri = result.data?.data
            if (result.resultCode != Activity.RESULT_OK || uri == null) resolve(id, null) else { persist(uri, true); resolve(id, files.treePath(uri)) }
        }) reject(id, IllegalStateException("Nenhum aplicativo de arquivos disponível."))
    }

    // ---------- camera scanning ----------

    /** The scanner helper contract on Android: photos (camera) or pictures (gallery) become page-NNNN.png in `folder`. */
    private fun capture(id: Int, input: JSONObject) = main.post {
        val folder = File(input.getString("folder"))
        val source = input.optString("source", "camera")
        val color = input.optString("color", "color")
        val maxSide = input.optInt("maxSide", 3508)
        if (source == "gallery") {
            val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*").putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 50)
                else Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            if (!activity.launch(intent) { result ->
                pool.execute {
                    try {
                        val data = result.data
                        val uris = if (result.resultCode != Activity.RESULT_OK || data == null) emptyList()
                            else data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } } ?: listOfNotNull(data.data)
                        uris.forEachIndexed { n, uri -> writePage(uri, File(folder, "page-%04d.png".format(n + 1)), color, maxSide) }
                        resolve(id, uris.size)
                    } catch (e: Exception) { reject(id, e) }
                }
            }) reject(id, IllegalStateException("Nenhuma galeria de imagens disponível."))
            return@post
        }
        val shot = File(activity.cacheDir, "camera/foto-${System.nanoTime()}.jpg").apply { parentFile?.mkdirs() }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", shot)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (!activity.launch(intent) { result ->
            pool.execute {
                try {
                    if (result.resultCode != Activity.RESULT_OK || shot.length() == 0L) { shot.delete(); resolve(id, 0); return@execute }
                    writePage(Uri.fromFile(shot), File(folder, "page-0001.png"), color, maxSide)
                    shot.delete(); resolve(id, 1)
                } catch (e: Exception) { shot.delete(); reject(id, e) }
            }
        }) reject(id, IllegalStateException("Nenhum aplicativo de câmera disponível."))
    }

    private fun decode(uri: Uri, maxSide: Int): Bitmap {
        if (Build.VERSION.SDK_INT >= 28) {
            val source = if (uri.scheme == "file") ImageDecoder.createSource(File(uri.path!!)) else ImageDecoder.createSource(activity.contentResolver, uri)
            return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val side = maxOf(info.size.width, info.size.height)
                if (side > maxSide) { val k = maxSide.toFloat() / side; decoder.setTargetSize((info.size.width * k).toInt(), (info.size.height * k).toInt()) }
            }
        }
        val open = { activity.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Imagem indisponível.") }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; open().use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1; while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        var bitmap = open().use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: throw IllegalStateException("Imagem inválida.")
        val orientation = open().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
        val degrees = when (orientation) { ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f }
        if (degrees != 0f) bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
        val side = maxOf(bitmap.width, bitmap.height)
        if (side > maxSide) { val k = maxSide.toFloat() / side; bitmap = Bitmap.createScaledBitmap(bitmap, (bitmap.width * k).toInt(), (bitmap.height * k).toInt(), true) }
        return bitmap
    }

    private fun writePage(uri: Uri, out: File, color: String, maxSide: Int) {
        val picture = decode(uri, maxSide)
        val result = if (color == "color") picture else {
            val target = Bitmap.createBitmap(picture.width, picture.height, Bitmap.Config.ARGB_8888)
            val matrix = ColorMatrix().apply { setSaturation(0f) }
            if (color == "bw") matrix.postConcat(ColorMatrix(floatArrayOf(2.2f, 0f, 0f, 0f, -200f, 0f, 2.2f, 0f, 0f, -200f, 0f, 0f, 2.2f, 0f, -200f, 0f, 0f, 0f, 1f, 0f)))
            Canvas(target).drawBitmap(picture, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(matrix) })
            target
        }
        FileOutputStream(out).use { result.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    // ---------- HTML to PDF and printing ----------

    private fun assetUrl(path: String) = "https://${MainActivity.HOST}/__fs" + path.split('/').joinToString("/") { Uri.encode(it) }

    private fun htmlToPdf(id: Int, input: JSONObject) {
        val output = File(input.getString("output"))
        html.render(assetUrl(input.getString("path")), output, input.getInt("widthMils"), input.getInt("heightMils")) { error ->
            if (error == null) resolve(id, output.path) else reject(id, IllegalStateException(error))
        }
    }

    private fun print(id: Int, input: JSONObject) = main.post {
        val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
        val name = input.optString("name", "GCP-PDF")
        val path = input.getString("path")
        if (input.optString("kind") == "html") {
            val view = WebView(activity); printView = view
            view.settings.javaScriptEnabled = false
            view.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.host == MainActivity.HOST) activity.loader.shouldInterceptRequest(request.url) else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), null)
                override fun onPageFinished(view: WebView, url: String) {
                    val attributes = PrintAttributes.Builder().setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .setColorMode(if (input.optBoolean("color", true)) PrintAttributes.COLOR_MODE_COLOR else PrintAttributes.COLOR_MODE_MONOCHROME).build()
                    // Resolved when the system dialog is done with the document: the caller removes the
                    // temporary files only then (the print service reads them after the dialog opens).
                    manager.print(name, FinishingAdapter(view.createPrintDocumentAdapter(name)) { printView = null; resolve(id, true) }, attributes)
                }
            }
            view.loadUrl(assetUrl(path))
            return@post
        }
        // A finished PDF: the system dialog receives the exact bytes the app would save.
        manager.print(name, object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes, cancel: android.os.CancellationSignal?, callback: LayoutResultCallback, extras: android.os.Bundle?) {
                if (cancel?.isCanceled == true) { callback.onLayoutCancelled(); return }
                callback.onLayoutFinished(PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), old != new)
            }
            override fun onWrite(pages: Array<out android.print.PageRange>, destination: android.os.ParcelFileDescriptor, cancel: android.os.CancellationSignal?, callback: WriteResultCallback) {
                pool.execute {
                    try {
                        files.open(path).use { input -> FileOutputStream(destination.fileDescriptor).use { input.copyTo(it) } }
                        callback.onWriteFinished(arrayOf(android.print.PageRange.ALL_PAGES))
                    } catch (e: Exception) { callback.onWriteFailed(e.message) }
                }
            }
            // The file must exist until the print service has read it: answer only when the dialog is done.
            override fun onFinish() { resolve(id, true) }
        }, null)
    }

    /** Passes everything to the WebView's adapter and reports when the system print dialog has finished with it. */
    private class FinishingAdapter(private val inner: PrintDocumentAdapter, private val finished: () -> Unit) : PrintDocumentAdapter() {
        override fun onStart() = inner.onStart()
        override fun onLayout(old: PrintAttributes?, new: PrintAttributes, cancel: android.os.CancellationSignal?, callback: LayoutResultCallback, extras: android.os.Bundle?) = inner.onLayout(old, new, cancel, callback, extras)
        override fun onWrite(pages: Array<out android.print.PageRange>, destination: android.os.ParcelFileDescriptor, cancel: android.os.CancellationSignal?, callback: WriteResultCallback) = inner.onWrite(pages, destination, cancel, callback)
        override fun onFinish() { inner.onFinish(); finished() }
    }

    // ---------- network (AI providers and update checks, without browser CORS limits, like the desktop) ----------

    private fun fetch(input: JSONObject): JSONObject {
        val url = URL(input.getString("url"))
        if (url.protocol != "https" && !(url.protocol == "http" && url.host in listOf("127.0.0.1", "localhost", "[::1]", "10.0.2.2"))) throw IllegalArgumentException("Use HTTPS ou um servidor local.")
        var connection = url.openConnection() as HttpURLConnection
        connection.requestMethod = input.optString("method", "GET")
        connection.connectTimeout = 30_000
        connection.readTimeout = input.optInt("timeout", 180_000)
        connection.instanceFollowRedirects = input.optString("redirect", "follow") == "follow"
        input.optJSONObject("headers")?.let { headers -> headers.keys().forEach { connection.setRequestProperty(it, headers.getString(it)) } }
        val body = input.optString("body", "")
        if (body.isNotEmpty()) { connection.doOutput = true; connection.outputStream.use { it.write(Base64.decode(body, Base64.NO_WRAP)) } }
        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
        val headers = JSONObject()
        connection.headerFields.forEach { (key, values) -> if (key != null) headers.put(key.lowercase(), values.joinToString(", ")) }
        val result = JSONObject().put("status", status).put("statusText", connection.responseMessage ?: "").put("url", connection.url.toString())
            .put("headers", headers).put("body", Base64.encodeToString(bytes, Base64.NO_WRAP))
        connection.disconnect()
        return result
    }

    /** Large downloads (an update APK) go straight to a file, reporting progress as events. */
    private fun download(id: Int, input: JSONObject): JSONObject {
        val url = URL(input.getString("url"))
        if (url.protocol != "https") throw IllegalArgumentException("Use HTTPS.")
        val target = File(activity.cacheDir, "updates/${input.getString("name").replace('/', '_')}").apply { parentFile?.mkdirs() }
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000; connection.readTimeout = 120_000
        if (connection.responseCode != 200) throw IllegalStateException("O download respondeu ${connection.responseCode}.")
        val total = connection.contentLengthLong
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        var done = 0L; var last = 0L
        connection.inputStream.use { stream -> FileOutputStream(target).use { out ->
            val buffer = ByteArray(1 shl 16)
            while (true) { val r = stream.read(buffer); if (r < 0) break; out.write(buffer, 0, r); digest.update(buffer, 0, r); done += r
                if (done - last > 512 * 1024) { last = done; emit("download", JSONObject().put("id", id).put("done", done).put("total", total)) } }
        } }
        return JSONObject().put("path", target.path).put("size", done).put("sha256", digest.digest().joinToString("") { "%02x".format(it) })
    }
}
