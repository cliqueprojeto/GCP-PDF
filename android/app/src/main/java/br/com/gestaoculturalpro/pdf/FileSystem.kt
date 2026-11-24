package br.com.gestaoculturalpro.pdf

import android.content.Context
import android.content.res.AssetManager
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * The one owner of path interpretation for the shared engine. Paths are POSIX strings:
 *  - real files inside the app sandbox (files and cache directories),
 *  - `/android_asset/…` bundled read-only assets,
 *  - `/saf/<encoded document uri>/<display name>` a document the user picked or shared,
 *  - `/safdir/<encoded tree uri>[/<child name>]` a folder the user picked and its direct children.
 * Temporary siblings written next to a document (`<name>.gcp-<uuid>.tmp`, see atomicWrite) live in the
 * cache and are copied into the document on rename, so a save never leaves a half-written file behind.
 */
class FileSystem(private val context: Context) {
    private val assets: AssetManager = context.assets
    private val resolver get() = context.contentResolver
    private val tempRoot = File(context.cacheDir, "saf-tmp").apply { mkdirs() }
    private val writers = ConcurrentHashMap<Int, Writer>()
    private val nextWriter = AtomicInteger(1)

    private class Writer(val target: String, val stream: OutputStream, val file: File?)

    sealed interface Target
    data class Real(val file: File) : Target
    data class Asset(val path: String) : Target
    data class Document(val uri: Uri, val name: String) : Target
    data class Tree(val tree: Uri) : Target
    data class TreeChild(val tree: Uri, val name: String) : Target

    private fun isTemp(name: String) = name.matches(Regex(".+\\.gcp-[0-9a-fA-F-]+\\.tmp"))

    fun resolve(path: String): Target {
        val clean = if (path.length > 1) path.trimEnd('/') else path
        if (clean == "/android_asset" || clean.startsWith("/android_asset/")) return Asset(clean.removePrefix("/android_asset").trimStart('/'))
        if (clean.startsWith("/saf/")) {
            val rest = clean.removePrefix("/saf/")
            val slash = rest.indexOf('/')
            val uri = Uri.parse(Uri.decode(if (slash < 0) rest else rest.substring(0, slash)))
            val name = if (slash < 0) "" else rest.substring(slash + 1)
            if (isTemp(name)) return Real(File(tempRoot, safeName(name)))
            return Document(uri, name)
        }
        if (clean.startsWith("/safdir/")) {
            val rest = clean.removePrefix("/safdir/")
            val slash = rest.indexOf('/')
            val tree = Uri.parse(Uri.decode(if (slash < 0) rest else rest.substring(0, slash)))
            if (slash < 0) return Tree(tree)
            val name = rest.substring(slash + 1)
            if (isTemp(name)) return Real(File(tempRoot, safeName(name)))
            if (name.contains('/')) throw IOException("EACCES: só é possível gravar diretamente na pasta escolhida")
            return TreeChild(tree, name)
        }
        val file = File(clean).canonicalFile
        val allowed = listOf(context.filesDir, context.cacheDir, context.codeCacheDir, File(context.applicationInfo.nativeLibraryDir), File("/system/fonts"), File("/product/fonts"))
            .map { it.canonicalFile }
        if (allowed.none { file.path == it.path || file.path.startsWith(it.path + "/") }) throw IOException("EACCES: caminho fora da área do aplicativo: $path")
        return Real(file)
    }

    private fun safeName(name: String) = name.replace('/', '_')

    fun documentPath(uri: Uri, fallbackName: String? = null): String {
        var name = displayName(uri) ?: fallbackName ?: uri.lastPathSegment?.substringAfterLast('/') ?: "documento"
        name = safeName(name)
        if (!name.contains('.')) {
            val type = resolver.getType(uri)
            val extension = type?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
            if (extension != null) name = "$name.$extension"
        }
        return "/saf/" + Uri.encode(uri.toString()) + "/" + name
    }

    fun treePath(tree: Uri) = "/safdir/" + Uri.encode(tree.toString())

    fun displayName(uri: Uri): String? = query(uri, OpenableColumns.DISPLAY_NAME) { it.getString(0) }

    private fun <T> query(uri: Uri, column: String, read: (Cursor) -> T?): T? = try {
        resolver.query(uri, arrayOf(column), null, null, null)?.use { if (it.moveToFirst() && !it.isNull(0)) read(it) else null }
    } catch (_: Exception) { null }

    private fun treeDocument(tree: Uri) = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

    private fun findChild(tree: Uri, name: String): Uri? {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
            while (it.moveToNext()) if (it.getString(1) == name) return DocumentsContract.buildDocumentUriUsingTree(tree, it.getString(0))
        }
        return null
    }

    private fun mimeFor(name: String): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"

    // ---- queries ----

    fun stat(path: String): JSONObject {
        val result = JSONObject()
        when (val target = try { resolve(path) } catch (_: IOException) { return result.put("exists", false) }) {
            is Real -> {
                val f = target.file
                if (!f.exists()) return result.put("exists", false)
                result.put("exists", true).put("isFile", f.isFile).put("isDirectory", f.isDirectory).put("size", f.length()).put("mtimeMs", f.lastModified())
            }
            is Asset -> {
                val list = try { assets.list(target.path) } catch (_: IOException) { null }
                if (!list.isNullOrEmpty() || target.path.isEmpty()) return result.put("exists", true).put("isFile", false).put("isDirectory", true).put("size", 0).put("mtimeMs", 0)
                val size = assetSize(target.path) ?: return result.put("exists", false)
                result.put("exists", true).put("isFile", true).put("isDirectory", false).put("size", size).put("mtimeMs", 0)
            }
            is Document -> {
                val size = query(target.uri, OpenableColumns.SIZE) { it.getLong(0) }
                val exists = size != null || try { resolver.openInputStream(target.uri)?.close(); true } catch (_: Exception) { false }
                if (!exists) return result.put("exists", false)
                result.put("exists", true).put("isFile", true).put("isDirectory", false).put("size", size ?: 0).put("mtimeMs",
                    query(target.uri, DocumentsContract.Document.COLUMN_LAST_MODIFIED) { it.getLong(0) } ?: 0)
            }
            is Tree -> result.put("exists", true).put("isFile", false).put("isDirectory", true).put("size", 0).put("mtimeMs", 0)
            is TreeChild -> {
                val child = findChild(target.tree, target.name) ?: return result.put("exists", false)
                result.put("exists", true).put("isFile", true).put("isDirectory", false).put("size", query(child, OpenableColumns.SIZE) { it.getLong(0) } ?: 0).put("mtimeMs", 0)
            }
        }
        return result
    }

    private fun assetSize(path: String): Long? = try {
        assets.openFd(path).use { it.length }
    } catch (_: IOException) {
        try { assets.open(path).use { stream -> var n = 0L; val buffer = ByteArray(65536); while (true) { val r = stream.read(buffer); if (r < 0) break; n += r }; n } } catch (_: IOException) { null }
    }

    fun readdir(path: String): JSONArray {
        val out = JSONArray()
        when (val target = resolve(path)) {
            is Real -> (target.file.listFiles() ?: throw FileNotFoundException("ENOENT: $path")).sortedBy { it.name }.forEach {
                out.put(JSONObject().put("name", it.name).put("isFile", it.isFile).put("isDirectory", it.isDirectory))
            }
            is Asset -> (assets.list(target.path) ?: emptyArray()).sorted().forEach { name ->
                val child = if (target.path.isEmpty()) name else "${target.path}/$name"
                val dir = !(assets.list(child).isNullOrEmpty())
                out.put(JSONObject().put("name", name).put("isFile", !dir).put("isDirectory", dir))
            }
            is Tree -> {
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(target.tree, DocumentsContract.getTreeDocumentId(target.tree))
                resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)?.use {
                    while (it.moveToNext()) {
                        val dir = it.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR
                        out.put(JSONObject().put("name", it.getString(0)).put("isFile", !dir).put("isDirectory", dir))
                    }
                }
            }
            else -> throw IOException("ENOTDIR: $path")
        }
        return out
    }

    fun realpath(path: String): String = when (val target = resolve(path)) {
        is Real -> target.file.canonicalPath
        else -> path
    }

    // ---- reading ----

    fun open(path: String): InputStream = when (val target = resolve(path)) {
        is Real -> target.file.inputStream()
        is Asset -> assets.open(target.path, AssetManager.ACCESS_STREAMING)
        is Document -> resolver.openInputStream(target.uri) ?: throw FileNotFoundException("ENOENT: $path")
        is TreeChild -> resolver.openInputStream(findChild(target.tree, target.name) ?: throw FileNotFoundException("ENOENT: $path")) ?: throw FileNotFoundException("ENOENT: $path")
        is Tree -> throw IOException("EISDIR: $path")
    }

    fun readRange(path: String, offset: Long, length: Int): ByteArray {
        val target = resolve(path)
        if (target is Real) {
            java.io.RandomAccessFile(target.file, "r").use { file ->
                if (offset >= file.length()) return ByteArray(0)
                val size = minOf(length.toLong(), file.length() - offset).toInt()
                val bytes = ByteArray(size); file.seek(offset); file.readFully(bytes); return bytes
            }
        }
        open(path).use { stream ->
            var skipped = 0L
            while (skipped < offset) { val s = stream.skip(offset - skipped); if (s <= 0) return ByteArray(0); skipped += s }
            val bytes = ByteArray(length); var read = 0
            while (read < length) { val r = stream.read(bytes, read, length - read); if (r < 0) break; read += r }
            return if (read == length) bytes else bytes.copyOf(read)
        }
    }

    // ---- writing ----

    /** Starts a write; `flag` is the Node flag: "w" (replace), "wx" (create only) or "a" (append). */
    fun beginWrite(path: String, flag: String): Int {
        val stream: OutputStream
        var file: File? = null
        when (val target = resolve(path)) {
            is Real -> {
                file = target.file
                if (flag == "wx" && file.exists()) throw IOException("EEXIST: $path")
                file.parentFile?.let { if (!it.isDirectory) throw FileNotFoundException("ENOENT: ${it.path}") }
                stream = java.io.FileOutputStream(file, flag == "a")
            }
            is Document -> stream = resolver.openOutputStream(target.uri, if (flag == "a") "wa" else "wt") ?: throw IOException("EACCES: $path")
            is TreeChild -> {
                val existing = findChild(target.tree, target.name)
                if (existing != null && flag == "wx") throw IOException("EEXIST: $path")
                val uri = existing ?: DocumentsContract.createDocument(resolver, treeDocument(target.tree), mimeFor(target.name), target.name)
                    ?: throw IOException("EACCES: não foi possível criar ${target.name}")
                stream = resolver.openOutputStream(uri, "wt") ?: throw IOException("EACCES: $path")
            }
            else -> throw IOException("EACCES: somente leitura: $path")
        }
        val id = nextWriter.getAndIncrement()
        writers[id] = Writer(path, stream.buffered(1 shl 16), file)
        return id
    }

    fun writeChunk(id: Int, bytes: ByteArray) {
        val writer = writers[id] ?: throw IOException("Gravação encerrada.")
        writer.stream.write(bytes)
    }

    fun endWrite(id: Int, abort: Boolean) {
        val writer = writers.remove(id) ?: return
        try { writer.stream.flush(); writer.stream.close() } finally { if (abort) writer.file?.delete() }
    }

    fun mkdir(path: String, recursive: Boolean) {
        when (val target = resolve(path)) {
            is Real -> {
                if (target.file.isDirectory) { if (!recursive) throw IOException("EEXIST: $path"); return }
                if (!(if (recursive) target.file.mkdirs() else target.file.mkdir())) throw IOException("ENOENT: $path")
            }
            is Tree -> {}
            else -> throw IOException("EACCES: $path")
        }
    }

    fun rm(path: String, recursive: Boolean, force: Boolean) {
        when (val target = resolve(path)) {
            is Real -> {
                if (!target.file.exists()) { if (force) return else throw FileNotFoundException("ENOENT: $path") }
                val ok = if (target.file.isDirectory) { if (!recursive) throw IOException("EISDIR: $path"); target.file.deleteRecursively() } else target.file.delete()
                if (!ok) throw IOException("EACCES: $path")
            }
            is TreeChild -> {
                val child = findChild(target.tree, target.name)
                if (child != null) DocumentsContract.deleteDocument(resolver, child) else if (!force) throw FileNotFoundException("ENOENT: $path")
            }
            is Document -> if (!force) throw IOException("EACCES: documentos externos não são apagados pelo aplicativo")
            else -> if (!force) throw IOException("EACCES: $path")
        }
    }

    fun copy(from: String, to: String) {
        open(from).use { input ->
            val id = beginWrite(to, "w")
            var failed = true
            try {
                val buffer = ByteArray(1 shl 16)
                while (true) { val r = input.read(buffer); if (r < 0) break; writers[id]!!.stream.write(buffer, 0, r) }
                failed = false
            } finally { endWrite(id, failed) }
        }
    }

    fun rename(from: String, to: String) {
        val source = resolve(from)
        val target = resolve(to)
        if (source is Real && target is Real) {
            if (!source.file.exists()) throw FileNotFoundException("ENOENT: $from")
            if (source.file.renameTo(target.file)) return
        }
        copy(from, to)
        rm(from, recursive = true, force = true)
    }

    fun shareableUri(path: String): Uri? = when (val target = resolve(path)) {
        is Document -> target.uri
        is TreeChild -> findChild(target.tree, target.name)
        else -> null
    }
}
