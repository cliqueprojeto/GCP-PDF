import Foundation
import ImageCaptureCore
import AppKit

// Short-lived ICA client. Only the acquisition directory supplied by main receives files.
final class ScannerClient: NSObject, ICDeviceBrowserDelegate, ICScannerDeviceDelegate {
    let browser = ICDeviceBrowser()
    let args = CommandLine.arguments
    var scanners: [ICScannerDevice] = []
    var selected: ICScannerDevice?
    var finished = false
    var selecting = false
    var scanning = false
    var count = 0
    func finish(_ value: Any? = nil, _ error: Error? = nil) {
        guard !finished else { return }; finished = true
        if let error = error { fputs("\(error.localizedDescription)\n", stderr) }
        if let value = value, let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) { print(json) }
        selected?.requestCloseSession(); browser.stop()
        exit(error == nil ? 0 : 1)
    }
    func fail(_ text: String) { finish(nil, NSError(domain: "GCPScanner", code: 1, userInfo: [NSLocalizedDescriptionKey:text])) }
    func start() {
        browser.delegate = self
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(rawValue: ICDeviceTypeMask.scanner.rawValue | ICDeviceLocationTypeMask.local.rawValue)!
        browser.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            if self.args[1] == "list" { self.finish(self.scanners.map { ["id": $0.uuidString ?? "", "name": $0.name ?? "Scanner"] }) }
            else if self.selected == nil { self.fail("Scanner não encontrado pelo Image Capture. Verifique o driver ICA e a conexão.") }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 165) { self.selected?.cancelScan(); self.fail("Tempo de digitalização esgotado.") }
    }
    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let scanner = device as? ICScannerDevice else { return }
        scanners.append(scanner)
        if args.count > 2 && scanner.uuidString == args[2] && selected == nil { selected = scanner; scanner.delegate = self; scanner.requestOpenSession() }
    }
    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) { scanners.removeAll { $0 === device }; if selected === device { fail("Scanner desconectado.") } }
    func didRemove(_ device: ICDevice) { fail("Scanner desconectado.") }
    func device(_ device: ICDevice, didOpenSessionWithError error: Error?) { if let error = error { finish(nil,error) } }
    func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {}
    func device(_ device: ICDevice, didEncounterError error: Error?) { if let error = error { finish(nil,error) } }
    func deviceDidBecomeReady(_ device: ICDevice) { if let scanner = device as? ICScannerDevice { ready(scanner) } }
    func scannerDeviceDidBecomeAvailable(_ scanner: ICScannerDevice) { ready(scanner) }
    func ready(_ scanner: ICScannerDevice) {
        guard !selecting && !scanning else { return }
        if args[1] == "capabilities" {
            var sources: [String] = []
            if scanner.availableFunctionalUnitTypes.contains(NSNumber(value: ICScannerFunctionalUnitType.flatbed.rawValue)) { sources.append("Mesa") }
            if scanner.availableFunctionalUnitTypes.contains(NSNumber(value: ICScannerFunctionalUnitType.documentFeeder.rawValue)) {
                selecting = true; scanner.requestSelect(.documentFeeder); return
            }
            finish(["sources": sources,"nativeUi": false,"description":"macOS Image Capture • driver ICA local."])
            return
        }
        guard args.count > 4, let data = args[4].data(using:.utf8), let o = try? JSONSerialization.jsonObject(with:data) as? [String:Any], let source = o["source"] as? String else { fail("Opções inválidas."); return }
        let target: ICScannerFunctionalUnitType = source == "Mesa" ? .flatbed : .documentFeeder
        selecting = true; scanner.requestSelect(target)
    }
    func scannerDevice(_ scanner: ICScannerDevice, didSelect unit: ICScannerFunctionalUnit, error: Error?) {
        if let error = error { finish(nil,error); return }
        if args[1] == "capabilities" {
            var sources: [String] = []
            if scanner.availableFunctionalUnitTypes.contains(NSNumber(value: ICScannerFunctionalUnitType.flatbed.rawValue)) { sources.append("Mesa") }
            sources.append("Alimentador")
            if let feeder = unit as? ICScannerFunctionalUnitDocumentFeeder, feeder.supportsDuplexScanning { sources.append("Alimentador duplex") }
            finish(["sources":sources,"nativeUi":false,"description":"macOS Image Capture • o alimentador pode digitalizar todas as folhas carregadas."])
            return
        }
        guard !scanning, let data = args[4].data(using:.utf8), let o = try? JSONSerialization.jsonObject(with:data) as? [String:Any], let dpi = o["dpi"] as? Int else { return }
        guard unit.supportedResolutions.contains(dpi) else { fail("Resolução não suportada pelo scanner. Escolha outra resolução."); return }
        scanning = true
        unit.resolution = dpi; unit.measurementUnit = .inches
        unit.pixelDataType = o["color"] as? String == "gray" ? .gray : o["color"] as? String == "bw" ? .BW : .RGB
        let papers: [String:[Double]] = ["A4":[210,297],"A3":[297,420],"A5":[148,210],"Carta":[215.9,279.4],"Ofício":[215.9,355.6]]
        let size = papers[o["paper"] as? String ?? "A4"] ?? [210,297]
        guard size[0]/25.4 <= unit.physicalSize.width + 0.05 && size[1]/25.4 <= unit.physicalSize.height + 0.05 else { fail("Papel maior que a área do scanner."); return }
        unit.scanArea = NSRect(x:0,y:0,width:size[0]/25.4,height:size[1]/25.4)
        if let feeder = unit as? ICScannerFunctionalUnitDocumentFeeder { feeder.duplexScanningEnabled = o["source"] as? String == "Alimentador duplex" }
        scanner.transferMode = .fileBased
        scanner.downloadsDirectory = URL(fileURLWithPath:args[3],isDirectory:true)
        scanner.documentUTI = "public.png"; scanner.documentName = "capture"
        scanner.requestScan()
    }
    func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
        count += 1
        guard count <= 100 else { scanner.cancelScan(); fail("Limite de 100 páginas por aquisição."); return }
        let target = URL(fileURLWithPath:args[3]).appendingPathComponent(String(format:"page-%04d.png",count))
        do { try FileManager.default.moveItem(at:url,to:target) } catch { finish(nil,error) }
    }
    func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: Error?) { finish(nil,error) }
}
guard CommandLine.arguments.count >= 2 else { exit(1) }
let client = ScannerClient(); client.start(); RunLoop.main.run()
