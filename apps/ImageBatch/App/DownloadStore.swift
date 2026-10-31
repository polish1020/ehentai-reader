import Foundation
import Combine
import UIKit

@MainActor final class DownloadStore: NSObject, ObservableObject {
    static let shared = DownloadStore()
    @Published private(set) var batches: [DownloadBatch] = []
    @Published var notice: String?
    @Published private(set) var isRestoring = true
    var backgroundCompletion: (() -> Void)?
    private let bridge = DownloadDelegate()
    private var active: [UUID: URLSessionDownloadTask] = [:]
    private var deliveries = Set<UUID>()
    private var lastProgress: [UUID: Date] = [:]
    private var persistenceAvailable = true
    private(set) lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: "imagebatch.transfers.v1")
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 3; configuration.waitsForConnectivity = true
        configuration.isDiscretionary = false; configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 6 * 60 * 60
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: configuration, delegate: bridge, delegateQueue: queue)
    }()

    override init() {
        super.init(); bridge.owner = self
        do { try FileStorage.prepare(); batches = try FileStorage.load() }
        catch {
            persistenceAvailable = false
            notice = "无法读取任务记录。为保护已有文件，暂未开始下载，请检查设备空间后重新打开。"
        }
        restore()
    }

    private func restore() {
        session.getAllTasks { [weak self] tasks in
            Task { @MainActor in
                guard let self else { return }
                for task in tasks {
                    guard let identity = TransferIdentity(taskDescription: task.taskDescription),
                          let (b, i) = self.position(identity.batchID, identity.itemID),
                          self.persistenceAvailable, self.batches[b].items[i].attemptID == identity.attemptID,
                          [.waiting, .downloading].contains(self.batches[b].items[i].state),
                          let download = task as? URLSessionDownloadTask else { task.cancel(); continue }
                    self.active[identity.itemID] = download
                    self.batches[b].items[i].state = .downloading; download.resume()
                }
                for b in self.batches.indices {
                    for i in self.batches[b].items.indices {
                        let item = self.batches[b].items[i]
                        if [.waiting, .downloading, .saving].contains(item.state), self.active[item.id] == nil {
                            self.batches[b].items[i].state = .waiting
                        } else if item.state == .completed, self.batches[b].destination.kind == .app,
                                  !FileStorage.manager.fileExists(atPath: FileStorage.file(batchID: self.batches[b].id, itemID: item.attemptID, filename: item.savedFilename ?? item.filename).path) {
                            self.batches[b].items[i].state = .failed
                            self.batches[b].items[i].error = "本地文件已移除，可重新下载。"
                        }
                    }
                }
                self.isRestoring = false; self.persist(); self.pump()
            }
        }
    }

    func add(_ list: ImportedList, updating id: UUID? = nil, destination: SaveDestination = SaveDestination()) throws {
        guard persistenceAvailable else { throw CocoaError(.fileWriteUnknown) }
        var next = batches
        var cancelledIDs = Set<UUID>()
        if let id, let index = next.firstIndex(where: { $0.id == id }) {
            let previous = Dictionary(next[index].items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            cancelledIDs = Set(next[index].items.filter { ![.completed, .saving].contains($0.state) }.map(\.id))
            for i in next[index].items.indices where cancelledIDs.contains(next[index].items[i].id) { next[index].items[i].state = .cancelled }
            next[index].updateLinks(list); next[index].name = list.name
            for i in next[index].items.indices {
                let item = next[index].items[i]
                if item.state == .waiting, let old = previous[item.id],
                   FileStorage.recovered(batchID: id, item: old) == nil {
                    next[index].items[i].attemptID = UUID()
                    next[index].items[i].received = 0; next[index].items[i].expected = 0
                }
            }
        } else {
            var batch = DownloadBatch(list: list, destination: destination)
            if destination.kind == .folder {
                guard destination.bookmark != nil else { throw DestinationError.folder }
                batch.destination.subfolder = ListImporter.safeFilename(list.name) + "-" + String(batch.id.uuidString.prefix(8))
            }
            next.insert(batch, at: 0)
        }
        // Persist before changing the network queue.
        try FileStorage.save(next); batches = next
        for itemID in cancelledIDs { active.removeValue(forKey: itemID)?.cancel() }
        pump()
    }

    func retry(_ batchID: UUID, itemID: UUID? = nil) {
        guard let index = batches.firstIndex(where: { $0.id == batchID }) else { return }
        for i in batches[index].items.indices {
            let item = batches[index].items[i]
            if [.failed, .cancelled].contains(item.state), itemID == nil || item.id == itemID {
                batches[index].items[i].state = .waiting; batches[index].items[i].error = nil
                if FileStorage.recovered(batchID: batchID, item: item) == nil {
                    batches[index].items[i].attemptID = UUID()
                    batches[index].items[i].received = 0; batches[index].items[i].expected = 0
                }
            }
        }
        persist(); pump()
    }

    func cancel(_ batchID: UUID) {
        guard let index = batches.firstIndex(where: { $0.id == batchID }) else { return }
        for i in batches[index].items.indices where [.waiting, .downloading].contains(batches[index].items[i].state) {
            let id = batches[index].items[i].id
            batches[index].items[i].state = .cancelled; active.removeValue(forKey: id)?.cancel()
        }
        // An already-started system Photos or file-provider commit finishes.
        persist(); pump()
    }

    func delete(_ batchID: UUID) {
        guard let batch = batches.first(where: { $0.id == batchID }) else { return }
        guard !batch.items.contains(where: { $0.state == .saving }) else {
            notice = "正在保存到目标位置，请等保存完成后再移除任务。"; return
        }
        cancel(batchID)
        do { if FileStorage.manager.fileExists(atPath: FileStorage.folder(batchID).path) { try FileStorage.manager.removeItem(at: FileStorage.folder(batchID)) } }
        catch { notice = "无法删除本机文件：\(error.localizedDescription)"; return }
        // Files/Photos outside our container belong to the user and are retained.
        batches.removeAll { $0.id == batchID }; persist()
    }

    private func pump() {
        guard !isRestoring, persistenceAvailable else { return }
        for b in batches.indices {
            for i in batches[b].items.indices {
                guard batches[b].items[i].state == .waiting else { continue }
                let item = batches[b].items[i], batchID = batches[b].id
                if let receipt = FileStorage.delivered(batchID: batchID, item: item), receipt.kind == batches[b].destination.kind {
                    batches[b].items[i].state = .completed
                    batches[b].items[i].savedFilename = receipt.filename
                    batches[b].items[i].assetIdentifier = receipt.assetIdentifier
                    persist(); continue
                }
                if let (name, bytes) = FileStorage.recovered(batchID: batchID, item: item) {
                    guard deliveries.count < 2 else { continue }
                    batches[b].items[i].received = bytes; batches[b].items[i].expected = bytes
                    deliver(batchID: batchID, itemID: item.id, filename: name)
                    continue
                }
                guard active.count < 3 else { continue }
                let task = session.downloadTask(with: item.url)
                task.taskDescription = TransferIdentity(batchID: batchID, itemID: item.id, filename: item.filename, attemptID: item.attemptID).taskDescription
                active[item.id] = task; batches[b].items[i].state = .downloading
                persist(); task.resume()
            }
        }
    }

    private func position(_ batch: UUID, _ item: UUID) -> (Int, Int)? {
        guard let b = batches.firstIndex(where: { $0.id == batch }), let i = batches[b].items.firstIndex(where: { $0.id == item }) else { return nil }
        return (b, i)
    }

    private func deliver(batchID: UUID, itemID: UUID, filename: String) {
        guard let (b, i) = position(batchID, itemID), !deliveries.contains(itemID) else { return }
        batches[b].items[i].state = .saving; deliveries.insert(itemID)
        let destination = batches[b].destination, item = batches[b].items[i]
        let file = FileStorage.file(batchID: batchID, itemID: item.attemptID, filename: filename)
        persist()
        Task {
            let lease = BackgroundSaveLease(); lease.begin()
            defer { lease.end() }
            do {
                let result = try await SaveDestinationWriter.save(file: file, destination: destination)
                guard let (b, i) = position(batchID, itemID), batches[b].items[i].attemptID == item.attemptID else { deliveries.remove(itemID); return }
                // Save the external commit receipt before updating task records.
                do { try FileStorage.recordDelivery(result, batchID: batchID, item: item) }
                catch { notice = "图片已保存，但保存完成记录失败。请检查本机存储空间。" }
                batches[b].items[i].state = .completed; batches[b].items[i].savedFilename = result.filename
                batches[b].items[i].assetIdentifier = result.assetIdentifier; batches[b].items[i].error = nil
                persist()
                if destination.kind != .app, persistenceAvailable { FileStorage.removeStagedImage(batchID: batchID, item: item) }
            } catch {
                if let (b, i) = position(batchID, itemID) {
                    batches[b].items[i].state = .failed
                    batches[b].items[i].error = "图片已下载，保存失败：\(error.localizedDescription)"
                }
                persist()
            }
            deliveries.remove(itemID); pump()
        }
    }

    func progress(_ identity: TransferIdentity, received: Int64, expected: Int64) {
        guard let (b, i) = position(identity.batchID, identity.itemID), batches[b].items[i].attemptID == identity.attemptID,
              batches[b].items[i].state == .downloading else { return }
        if let last = lastProgress[identity.itemID], Date().timeIntervalSince(last) < 0.2 { return }
        lastProgress[identity.itemID] = Date()
        batches[b].items[i].received = received; batches[b].items[i].expected = expected
    }

    func finished(_ identity: TransferIdentity, filename: String?, bytes: Int64 = 0, error: Error?) {
        guard let (b, i) = position(identity.batchID, identity.itemID), batches[b].items[i].attemptID == identity.attemptID else {
            if filename != nil { try? FileStorage.manager.removeItem(at: FileStorage.folder(identity.batchID).appendingPathComponent(identity.attemptID.uuidString)) }
            return
        }
        guard batches[b].items[i].state == .downloading else {
            if batches[b].items[i].state == .cancelled, filename != nil {
                try? FileStorage.manager.removeItem(at: FileStorage.folder(identity.batchID).appendingPathComponent(identity.attemptID.uuidString))
            }
            return
        }
        active.removeValue(forKey: identity.itemID); lastProgress.removeValue(forKey: identity.itemID)
        if let error {
            batches[b].items[i].state = .failed; batches[b].items[i].error = error.localizedDescription
        } else {
            batches[b].items[i].received = bytes; batches[b].items[i].expected = bytes
            batches[b].items[i].state = .waiting
        }
        persist(); pump()
    }

    func fileURL(batchID: UUID, item: DownloadItem) -> URL {
        FileStorage.file(batchID: batchID, itemID: item.attemptID, filename: item.savedFilename ?? item.filename)
    }

    func export(_ id: UUID, itemID: UUID? = nil) async throws -> URL {
        guard let batch = batches.first(where: { $0.id == id }) else { throw CocoaError(.fileNoSuchFile) }
        let directory = FileStorage.exportsURL.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileStorage.manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let item = batch.items.first { $0.id == itemID }
        let name = item.map { $0.savedFilename ?? $0.filename } ?? ListImporter.safeFilename(batch.name + ".zip")
        let destination = directory.appendingPathComponent(name)
        return try await Task.detached(priority: .userInitiated) {
            try SaveDestinationWriter.export(batch, to: destination, only: itemID)
        }.value
    }

    func persist() {
        guard persistenceAvailable else { return }
        do { try FileStorage.save(batches) }
        catch { persistenceAvailable = false; notice = "任务状态保存失败，已停止添加新下载。请检查设备存储空间后重新打开应用。" }
    }
}

@MainActor private final class BackgroundSaveLease {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    func begin() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "保存下载的图片") { [weak self] in
            Task { @MainActor in self?.end() }
        }
    }
    func end() {
        if identifier != .invalid { UIApplication.shared.endBackgroundTask(identifier); identifier = .invalid }
    }
}

private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
    weak var owner: DownloadStore?
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let identity = TransferIdentity(taskDescription: downloadTask.taskDescription) else { return }
        Task { @MainActor [weak self] in self?.owner?.progress(identity, received: totalBytesWritten, expected: totalBytesExpectedToWrite) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let identity = TransferIdentity(taskDescription: downloadTask.taskDescription) else { return }
        do {
            let (name, bytes) = try FileStorage.accept(location, response: downloadTask.response, identity: identity)
            Task { @MainActor [weak self] in self?.owner?.finished(identity, filename: name, bytes: bytes, error: nil) }
        } catch {
            Task { @MainActor [weak self] in self?.owner?.finished(identity, filename: nil, error: error) }
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let identity = TransferIdentity(taskDescription: task.taskDescription) else { return }
        Task { @MainActor [weak self] in self?.owner?.finished(identity, filename: nil, error: error) }
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor [weak self] in
            guard let store = self?.owner else { return }
            store.persist(); let completion = store.backgroundCompletion; store.backgroundCompletion = nil; completion?()
        }
    }
}
