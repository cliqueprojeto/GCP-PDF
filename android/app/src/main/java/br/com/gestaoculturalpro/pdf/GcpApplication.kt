package br.com.gestaoculturalpro.pdf

import android.app.Application
import java.io.File

class GcpApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Temporary work folders of a previous run (engine copies, conversions, camera shots) are not kept.
        for (name in listOf("saf-tmp", "camera", "share", "recebidos")) File(cacheDir, name).deleteRecursively()
        cacheDir.listFiles()?.filter { it.isDirectory && it.name.startsWith("gcp-") }?.forEach { it.deleteRecursively() }
    }
}
