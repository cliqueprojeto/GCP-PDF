package android.print

import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import java.io.File

/**
 * Writes a print adapter's output (Chromium's own PDF printer, as Electron's printToPDF uses) to a file
 * without showing the system print dialog. The callbacks' constructors are only reachable from this package.
 */
class PdfPrinter(private val attributes: PrintAttributes) {
    fun print(adapter: PrintDocumentAdapter, file: File, done: (String?) -> Unit) {
        adapter.onStart()
        adapter.onLayout(null, attributes, null, object : PrintDocumentAdapter.LayoutResultCallback() {
            override fun onLayoutFinished(info: PrintDocumentInfo, changed: Boolean) {
                val descriptor = try {
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_READ_WRITE)
                } catch (error: Exception) { adapter.onFinish(); done(error.message ?: "Falha ao criar o PDF."); return }
                adapter.onWrite(arrayOf(PageRange.ALL_PAGES), descriptor, CancellationSignal(), object : PrintDocumentAdapter.WriteResultCallback() {
                    override fun onWriteFinished(pages: Array<out PageRange>?) { descriptor.close(); adapter.onFinish(); done(null) }
                    override fun onWriteFailed(error: CharSequence?) { descriptor.close(); adapter.onFinish(); done(error?.toString() ?: "Falha ao gravar o PDF.") }
                    override fun onWriteCancelled() { descriptor.close(); adapter.onFinish(); done("Cancelado.") }
                })
            }
            override fun onLayoutFailed(error: CharSequence?) { adapter.onFinish(); done(error?.toString() ?: "Falha ao paginar o documento.") }
            override fun onLayoutCancelled() { adapter.onFinish(); done("Cancelado.") }
        }, null)
    }
}
