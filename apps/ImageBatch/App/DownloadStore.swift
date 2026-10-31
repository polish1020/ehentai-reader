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
    private var lastProgress: [UUID: Date] = [:]
    private var persistenceAvailable = true
    private(set) lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: "imagebatch.transfers.v1")
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 3
        configuration.waitsForConnectivity = true
        configuration.isDiscretionary = false
        configuration.timeoutIntervalForRequest = 60
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
                          self.persistenceAvailable,
                          [.waiting, .downloading].contains(self.batches[b].items[i].state),
                          let download = task as? URLSessionDownloadTask else { task.cancel(); continue }
                    self.active[identity.itemID] = download
                    self.batches[b].items[i].state = .downloading
                    download.resume()
                }
                for b in self.batches.indices {
                    for i in self.batches[b].items.indices {
                        let item = self.batches[b].items[i]
                        if [.waiting, .downloading].contains(item.state), self.active[item.id] == nil,
                           let (name, bytes) = FileStorage.recovered(batchID: self.batches[b].id, item: item) {
                            self.batches[b].items[i].state = .completed
                            self.batches[b].items[i].savedFilename = name
                            self.batches[b].items[i].received = bytes; self.batches[b].items[i].expected = bytes
                            self.batches[b].items[i].error = nil
                            continue
                        }
                        if item.state == .completed,
                           !FileStorage.manager.fileExists(atPath: FileStorage.file(batchID: self.batches[b].id, itemID: item.id, filename: item.savedFilename ?? item.filename).path) {
                            self.batches[b].items[i].state = .failed
                            self.batches[b].items[i].error = "本地文件已移除，可重新下载。"
                        } else if item.state == .downloading, self.active[item.id] == nil {
                            self.batches[b].items[i].state = .waiting
                        }
                    }
                }
                self.isRestoring = false; self.persist(); self.pump()
            }
        }
    }

    func add(_ list: ImportedList, updating id: UUID? = nil) throws {
        guard persistenceAvailable else { throw CocoaError(.fileWriteUnknown) }
        var next = batches
        var oldIDs = Set<UUID>()
        if let id, let index = next.firstIndex(where: { $0.id == id }) {
            oldIDs = Set(next[index].items.filter { $0.state != .completed }.map(\.id))
            for i in next[index].items.indices where oldIDs.contains(next[index].items[i].id) {
                next[index].items[i].state = .cancelled
            }
            next[index].updateLinks(list)
            // New identities prevent canceled transfers from overwriting replacements.
            for i in next[index].items.indices where oldIDs.contains(next[index].items[i].id) && next[index].items[i].state == .waiting {
                next[index].items[i].id = UUID()
            }
        } else { next.insert(DownloadBatch(list: list), at: 0) }
        // Commit before creating or cancelling network tasks. Failed imports
        // cannot leave an invisible unsaved queue running in the background.
        try FileStorage.save(next)
        batches = next
        for itemID in oldIDs { active.removeValue(forKey: itemID)?.cancel() }
        pump()
    }

    func retry(_ batchID: UUID, itemID: UUID? = nil) {
        guard let index = batches.firstIndex(where: { $0.id == batchID }) else { return }
        for i in batches[index].items.indices {
            let item = batches[index].items[i]
            if [.failed, .cancelled].contains(item.state), itemID == nil || item.id == itemID {
                batches[index].items[i].id = UUID()
                batches[index].items[i].state = .waiting
                batches[index].items[i].received = 0; batches[index].items[i].error = nil
            }
        }
        persist(); pump()
    }

    func cancel(_ batchID: UUID) {
        guard let index = batches.firstIndex(where: { $0.id == batchID }) else { return }
        for i in batches[index].items.indices where [.waiting, .downloading].contains(batches[index].items[i].state) {
            let id = batches[index].items[i].id
            batches[index].items[i].state = .cancelled
            active.removeValue(forKey: id)?.cancel()
        }
        persist(); pump()
    }

    func delete(_ batchID: UUID) {
        cancel(batchID)
        do { if FileStorage.manager.fileExists(atPath: FileStorage.folder(batchID).path) { try FileStorage.manager.removeItem(at: FileStorage.folder(batchID)) } }
        catch { notice = "无法删除本地文件：\(error.localizedDescription)"; return }
        batches.removeAll { $0.id == batchID }; persist()
    }

    private func pump() {
        guard !isRestoring, persistenceAvailable else { return }
        for b in batches.indices {
            for i in batches[b].items.indices {
                guard active.count < 3 else { return }
                guard batches[b].items[i].state == .waiting else { continue }
                let item = batches[b].items[i]
                let task = session.downloadTask(with: item.url)
                task.taskDescription = TransferIdentity(batchID: batches[b].id, itemID: item.id, filename: item.filename).taskDescription
                active[item.id] = task; batches[b].items[i].state = .downloading
                persist(); task.resume()
            }
        }
    }

    private func position(_ batch: UUID, _ item: UUID) -> (Int, Int)? {
        guard let b = batches.firstIndex(where: { $0.id == batch }),
              let i = batches[b].items.firstIndex(where: { $0.id == item }) else { return nil }
        return (b, i)
    }

    func progress(_ identity: TransferIdentity, received: Int64, expected: Int64) {
        guard let (b, i) = position(identity.batchID, identity.itemID), batches[b].items[i].state == .downloading else { return }
        if let last = lastProgress[identity.itemID], Date().timeIntervalSince(last) < 0.2 { return }
        lastProgress[identity.itemID] = Date()
        batches[b].items[i].received = received; batches[b].items[i].expected = expected
    }

    func finished(_ identity: TransferIdentity, filename: String?, bytes: Int64 = 0, error: Error?) {
        active.removeValue(forKey: identity.itemID); lastProgress.removeValue(forKey: identity.itemID)
        guard let (b, i) = position(identity.batchID, identity.itemID), batches[b].items[i].state == .downloading else {
            // A canceled/deleted task can finish between cancellation and its callback.
            if filename != nil { try? FileStorage.manager.removeItem(at: FileStorage.folder(identity.batchID).appendingPathComponent(identity.itemID.uuidString)) }
            pump(); return
        }
        if let error {
            batches[b].items[i].state = .failed
            batches[b].items[i].error = error.localizedDescription
        } else {
            batches[b].items[i].state = .completed
            batches[b].items[i].savedFilename = filename
            batches[b].items[i].received = bytes; batches[b].items[i].expected = bytes
            batches[b].items[i].error = nil
        }
        persist(); pump()
    }

    func fileURL(batchID: UUID, item: DownloadItem) -> URL {
        FileStorage.file(batchID: batchID, itemID: item.id, filename: item.savedFilename ?? item.filename)
    }

    func export(_ id: UUID) async throws -> URL {
        guard let batch = batches.first(where: { $0.id == id }) else { throw CocoaError(.fileNoSuchFile) }
        let entries = batch.items.filter { $0.state == .completed }.map { ZIPWriter.Entry(url: fileURL(batchID: id, item: $0), name: $0.savedFilename ?? $0.filename) }
        let destination = FileStorage.exportsURL.appendingPathComponent(UUID().uuidString + ".zip")
        return try await Task.detached(priority: .userInitiated) {
            try ZIPWriter.write(entries, to: destination); return destination
        }.value
    }

    func persist() {
        guard persistenceAvailable else { return }
        do { try FileStorage.save(batches) }
        catch { persistenceAvailable = false; notice = "任务状态保存失败，已停止添加新下载。请检查设备存储空间后重新打开应用。" }
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
