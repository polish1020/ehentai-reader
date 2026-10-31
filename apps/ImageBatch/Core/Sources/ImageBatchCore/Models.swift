import Foundation

public enum ItemState: String, Codable, Sendable {
    case waiting, downloading, completed, failed, cancelled
}

public struct DownloadItem: Codable, Identifiable, Sendable {
    public var id: UUID = UUID()
    public var url: URL
    public var filename: String
    public var savedFilename: String?
    public var state: ItemState = .waiting
    public var received: Int64 = 0
    public var expected: Int64 = 0
    public var error: String?
    public init(entry: DownloadEntry) { url = entry.url; filename = entry.filename }
}

public struct DownloadBatch: Codable, Identifiable, Sendable {
    public var id: UUID = UUID()
    public var name: String
    public var created: Date = Date()
    public var items: [DownloadItem]
    public var completedCount: Int { items.filter { $0.state == .completed }.count }
    public var failedCount: Int { items.filter { $0.state == .failed }.count }
    public var isActive: Bool { items.contains { $0.state == .waiting || $0.state == .downloading } }
    public init(list: ImportedList) { name = list.name; items = list.items.map(DownloadItem.init) }

    /// Refresh expiring links using stable filenames; keep verified local files.
    @discardableResult public mutating func updateLinks(_ list: ImportedList) -> Int {
        var changed = 0
        var indices = Dictionary(uniqueKeysWithValues: items.enumerated().map { ($0.element.filename, $0.offset) })
        for entry in list.items {
            if let index = indices[entry.filename] {
                guard items[index].state != .completed else { continue }
                items[index].url = entry.url; items[index].state = .waiting
                items[index].received = 0; items[index].expected = 0; items[index].error = nil
            } else {
                indices[entry.filename] = items.count; items.append(DownloadItem(entry: entry))
            }
            changed += 1
        }
        return changed
    }
}

public struct TransferIdentity: Codable, Sendable {
    public var batchID: UUID
    public var itemID: UUID
    public var filename: String
    public init(batchID: UUID, itemID: UUID, filename: String) {
        self.batchID = batchID; self.itemID = itemID; self.filename = filename
    }
    public var taskDescription: String? { (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } }
    public init?(taskDescription: String?) {
        guard let value = taskDescription, let data = value.data(using: .utf8),
              let identity = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        self = identity
    }
}
