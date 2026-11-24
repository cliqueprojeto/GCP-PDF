package br.com.gestaoculturalpro.pdf

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.ConcurrentLinkedQueue

class MainActivity : ComponentActivity() {
    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START = "https://$HOST/app/www/index.html"
    }

    lateinit var webView: WebView
        private set
    lateinit var files: FileSystem
        private set
    lateinit var bridge: NativeBridge
        private set
    lateinit var loader: WebViewAssetLoader
        private set
    private var ready = false
    private val launches = ConcurrentLinkedQueue<String>()
    private var pendingResult: ((ActivityResult) -> Unit)? = null
    private var fileChooser: ValueCallback<Array<Uri>>? = null
    private var dark = false

    val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val handler = pendingResult; pendingResult = null; handler?.invoke(result)
    }

    /** Starts a system screen (file picker, camera, installer) and hands its result to `handler`. */
    fun launch(intent: Intent, handler: (ActivityResult) -> Unit): Boolean {
        if (pendingResult != null) pendingResult?.invoke(ActivityResult(RESULT_CANCELED, null))
        pendingResult = handler
        return try { launcher.launch(intent); true } catch (_: ActivityNotFoundException) { pendingResult = null; false }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        enableEdgeToEdge(SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT), SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        // The system splash never waits long: the page shows its own loading state while the engine starts.
        val started = android.os.SystemClock.uptimeMillis()
        splash.setKeepOnScreenCondition { !ready && android.os.SystemClock.uptimeMillis() - started < 2500 }
        files = FileSystem(this)
        if (0 != applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) WebView.setWebContentsDebuggingEnabled(true)

        loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/app/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/__fs/", FilePathHandler())
            .build()

        val root = FrameLayout(this)
        webView = WebView(this)
        webView.setBackgroundColor(if (dark) Color.rgb(0x14, 0x13, 0x1b) else Color.rgb(0xf7, 0xf6, 0xfa))
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        bridge = NativeBridge(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            useWideViewPort = true
            loadWithOverviewMode = false
            offscreenPreRaster = true
        }
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.addJavascriptInterface(bridge, "GcpNative")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.host == HOST) return loader.shouldInterceptRequest(request.url)
                // The interface never loads third-party resources; network calls go through the native client.
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), null)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                openExternal(request.url)
                return true
            }
            override fun onPageFinished(view: WebView, url: String) { applyInsets() }
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // Chromium's renderer ran out of memory or crashed: start over with a fresh view; documents reopen from recents.
                recreate(); return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                android.util.Log.println(if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) android.util.Log.ERROR else android.util.Log.INFO, "GCP-PDF", "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileChooser?.onReceiveValue(null); fileChooser = callback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                val types = params.acceptTypes.filter { it.contains('/') }
                if (types.isNotEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                return launch(intent) { result ->
                    val uris = result.data?.let { data -> data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } } ?: data.data?.let { listOf(it) } }
                    fileChooser?.onReceiveValue(uris?.toTypedArray()); fileChooser = null
                }
            }
        }

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets -> lastInsets = insets; applyInsets(); WindowInsetsCompat.CONSUMED }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (ready) bridge.emit("back", JSONObject()) else finish() }
        })

        collectLaunch(intent)
        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        if (webView.url == null) webView.loadUrl(START)
    }

    private var lastInsets: WindowInsetsCompat? = null
    private val density get() = resources.displayMetrics.density

    /** System bars and the keyboard become CSS variables; the interface paints under the bars itself. */
    fun applyInsets() {
        val insets = lastInsets ?: return
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
        val keyboard = insets.isVisible(WindowInsetsCompat.Type.ime())
        (webView.parent as View).setPadding(0, 0, 0, if (keyboard) ime.bottom else 0)
        val d = density
        val css = JSONObject().put("top", bars.top / d).put("bottom", if (keyboard) 0 else bars.bottom / d).put("left", bars.left / d).put("right", bars.right / d).put("keyboard", keyboard)
        bridge.emit("insets", css)
    }

    fun setChrome(darkInterface: Boolean) = runOnUiThread {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !darkInterface
        controller.isAppearanceLightNavigationBars = !darkInterface
        webView.setBackgroundColor(if (darkInterface) Color.rgb(0x14, 0x13, 0x1b) else Color.rgb(0xf7, 0xf6, 0xfa))
    }

    fun markReady() = runOnUiThread { ready = true; applyInsets() }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        collectLaunch(intent)
        if (ready) bridge.emit("launch", JSONObject())
    }

    /** Files from "Abrir com" and "Compartilhar": kept as documents the engine can read through the resolver. */
    private fun collectLaunch(intent: Intent?) {
        intent ?: return
        val uris = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_VIEW, Intent.ACTION_EDIT -> intent.data?.let { uris.add(it) }
            Intent.ACTION_SEND -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM))?.let { uris.add(it) }
            Intent.ACTION_SEND_MULTIPLE -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM))?.let { uris.addAll(it) }
        }
        for (uri in uris) {
            val path = if (uri.scheme == "file") {
                // Old file managers: copy into the cache so the engine never reads arbitrary storage paths.
                try {
                    val source = File(uri.path!!)
                    val folder = File(cacheDir, "recebidos/${System.nanoTime()}").apply { mkdirs() }
                    val copy = File(folder, source.name); FileInputStream(source).use { input -> copy.outputStream().use { input.copyTo(it) } }; copy.path
                } catch (_: Exception) { null }
            } else {
                try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { }
                files.documentPath(uri)
            }
            if (path != null) launches.add(path)
        }
        intent.action = Intent.ACTION_MAIN
    }

    fun consumeLaunches(): JSONArray { val out = JSONArray(); while (true) out.put(launches.poll() ?: break); return out }

    fun openExternal(uri: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: ActivityNotFoundException) { }
    }

    fun share(paths: List<String>, mime: String, title: String) {
        val uris = paths.map { path -> files.shareableUri(path) ?: run {
            val source = files.resolve(path) as? FileSystem.Real ?: throw IllegalArgumentException("Arquivo indisponível para compartilhar.")
            val folder = File(cacheDir, "share/${System.nanoTime()}").apply { mkdirs() }
            val copy = File(folder, source.file.name); source.file.copyTo(copy, overwrite = true)
            FileProvider.getUriForFile(this, "$packageName.files", copy)
        } }
        val intent = if (uris.size == 1) Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
            else Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        intent.type = mime
        intent.clipData = ClipData.newRawUri(title, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runOnUiThread { startActivity(Intent.createChooser(intent, title)) }
    }

    fun installPackage(file: File): Boolean {
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            runOnUiThread { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
            return false
        }
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)) }
        return true
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val nowDark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        if (nowDark != dark) { dark = nowDark; if (ready) bridge.emit("system-theme", JSONObject().put("dark", dark)) }
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); webView.saveState(outState) }

    override fun onDestroy() {
        bridge.dispose()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    /** `/__fs/<absolute path>`: binary reads of engine paths for fetch(), streamed without copies through JavaScript. */
    private inner class FilePathHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? = try {
            val absolute = "/" + path.trimStart('/')
            val stream = files.open(absolute)
            val mime = when (absolute.substringAfterLast('.', "").lowercase()) {
                "html", "htm" -> "text/html"; "css" -> "text/css"; "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "svg" -> "image/svg+xml"
                "js", "mjs" -> "text/javascript"; "wasm" -> "application/wasm"; "json" -> "application/json"; "pdf" -> "application/pdf"
                "ttf" -> "font/ttf"; "otf" -> "font/otf"; "woff2" -> "font/woff2"; else -> "application/octet-stream"
            }
            WebResourceResponse(mime, null, 200, "OK", mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), stream)
        } catch (error: Exception) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), (error.message ?: "ENOENT").byteInputStream())
        }
    }
}
