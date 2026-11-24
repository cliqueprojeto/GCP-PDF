package br.com.gestaoculturalpro.pdf

import android.content.Context
import java.io.File
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Child processes of the shared engine. Only the bundled editing engine may run: the JavaScript side names
 * it as `…/pdfcraft-cli`, which resolves to the executable packaged as libpdfcraft.so for this device's ABI.
 * Output is streamed back as text; the owner of each process is the JavaScript `spawn` that started it.
 */
class EngineProcesses(private val context: Context, private val emit: (id: Int, kind: String, data: String) -> Unit) {
    private class Child(val process: Process, val stdin: OutputStream)
    private val children = ConcurrentHashMap<Int, Child>()

    private fun executable(name: String): File {
        val base = name.substringAfterLast('/')
        if (base != "pdfcraft-cli" && base != "pdfcraft-cli.exe") throw IOException("ENOENT: programa não disponível no Android: $base")
        val file = File(context.applicationInfo.nativeLibraryDir, "libpdfcraft.so")
        if (!file.isFile) throw IOException("ENOENT: o motor de edição não está instalado para esta arquitetura (${android.os.Build.SUPPORTED_ABIS.joinToString()}).")
        return file
    }

    fun start(id: Int, command: String, args: List<String>, cwd: String?) {
        val builder = ProcessBuilder(listOf(executable(command).path) + args)
        if (cwd != null) builder.directory(File(cwd))
        val environment = builder.environment()
        environment["HOME"] = context.filesDir.path
        environment["TMPDIR"] = context.cacheDir.path
        environment["RUST_BACKTRACE"] = "0"
        val process = builder.start()
        children[id] = Child(process, process.outputStream)
        pump(id, "stdout", process.inputStream)
        pump(id, "stderr", process.errorStream)
        thread(name = "engine-$id-exit", isDaemon = true) {
            val code = try { process.waitFor() } catch (_: InterruptedException) { -1 }
            children.remove(id)
            emit(id, "exit", code.toString())
        }
    }

    private fun pump(id: Int, kind: String, stream: java.io.InputStream) = thread(name = "engine-$id-$kind", isDaemon = true) {
        try {
            InputStreamReader(stream, Charsets.UTF_8).use { reader ->
                val buffer = CharArray(1 shl 16)
                while (true) {
                    val read = reader.read(buffer)
                    if (read < 0) break
                    emit(id, kind, String(buffer, 0, read))
                }
            }
        } catch (_: IOException) { }
    }

    fun write(id: Int, text: String) {
        val child = children[id] ?: throw IOException("EPIPE: o processo terminou")
        child.stdin.write(text.toByteArray(Charsets.UTF_8))
        child.stdin.flush()
    }

    fun closeInput(id: Int) { try { children[id]?.stdin?.close() } catch (_: IOException) { } }

    fun kill(id: Int) { children[id]?.process?.destroy() }

    fun killAll() { children.values.forEach { it.process.destroyForcibly() } }
}
