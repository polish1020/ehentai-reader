import Foundation

public enum ItemState: String, Codable, Sendable {
    case waiting, downloading, saving, completed, failed, cancelled
}
public enum DestinationKind: String, Codable, CaseIterable, Sendable { case app, folder, photos }

public struct SaveDestination: Codable, Equatable, Sendable {
    public var kind: DestinationKind = .app
    public var bookmark: Data?
    public var label: String?
    public var subfolder: String?
    public init(kind: DestinationKind = .app, bookmark: Data? = nil, label: String? = nil, subfolder: String? = nil) {
        self.kind = kind; self.bookmark = bookmark; self.label = label; self.subfolder = subfolder
    }
}

public struct DownloadItem: Codable, Identifiable, Sendable {
    public var id: UUID = UUID()
    public var attemptID: UUID = UUID()
    public var externalID: String?
    public var url: URL
    public var filename: String
    public var savedFilename: String?
    public var assetIdentifier: String?
    public var state: ItemState = .waiting
    public var received: Int64 = 0
    public var expected: Int64 = 0
    public var error: String?
    public init(entry: DownloadEntry) { externalID = entry.id; url = entry.url; filename = entry.filename }
    private enum CodingKeys: String, CodingKey { case id, attemptID, externalID, url, filename, savedFilename, assetIdentifier, state, received, expected, error }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        attemptID = try c.decodeIfPresent(UUID.self, forKey: .attemptID) ?? id
        externalID = try c.decodeIfPresent(String.self, forKey: .externalID)
        url = try c.decode(URL.self, forKey: .url); filename = try c.decode(String.self, forKey: .filename)
        savedFilename = try c.decodeIfPresent(String.self, forKey: .savedFilename)
        assetIdentifier = try c.decodeIfPresent(String.self, forKey: .assetIdentifier)
        state = try c.decode(ItemState.self, forKey: .state)
        received = try c.decode(Int64.self, forKey: .received); expected = try c.decode(Int64.self, forKey: .expected)
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }
}

public struct DownloadBatch: Codable, Identifiable, Sendable {
    public var id: UUID = UUID()
    public var name: String
    public var created: Date = Date()
    public var items: [DownloadItem]
    public var destination = SaveDestination()
    public var completedCount: Int { items.filter { $0.state == .completed }.count }
    public var failedCount: Int { items.filter { $0.state == .failed }.count }
    public var isActive: Bool { items.contains { [.waiting, .downloading, .saving].contains($0.state) } }
    public init(list: ImportedList, destination: SaveDestination = SaveDestination()) {
        name = list.name; items = list.items.map(DownloadItem.init); self.destination = destination
    }
    private enum CodingKeys: String, CodingKey { case id, name, created, items, destination }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id); name = try c.decode(String.self, forKey: .name)
        created = try c.decode(Date.self, forKey: .created); items = try c.decode([DownloadItem].self, forKey: .items)
        destination = try c.decodeIfPresent(SaveDestination.self, forKey: .destination) ?? SaveDestination()
    }

    /// Stable IDs take precedence over filenames; URLs can change independently.
    @discardableResult public mutating func updateLinks(_ list: ImportedList) -> Int {
        var changed = 0
        var ids = Dictionary(items.enumerated().compactMap { index, item in item.externalID.map { ($0, index) } }, uniquingKeysWith: { first, _ in first })
        var names = Dictionary(items.enumerated().map { ($0.element.filename, $0.offset) }, uniquingKeysWith: { first, _ in first })
        for entry in list.items {
            let index: Int?
            if let id = entry.id { index = ids[id] ?? names[entry.filename].flatMap { items[$0].externalID == nil ? $0 : nil } }
            else { index = names[entry.filename] }
            if let index {
                if items[index].externalID == nil { items[index].externalID = entry.id }
                if let id = items[index].externalID { ids[id] = index }
                guard ![.completed, .saving].contains(items[index].state) else { continue }
                items[index].url = entry.url; items[index].state = .waiting; items[index].error = nil
            } else {
                if let id = entry.id { ids[id] = items.count }
                names[entry.filename] = items.count; items.append(DownloadItem(entry: entry))
            }
            changed += 1
        }
        return changed
    }
}

public struct TransferIdentity: Codable, Sendable {
    public var batchID: UUID
    public var itemID: UUID
    public var attemptID: UUID
    public var filename: String
    public init(batchID: UUID, itemID: UUID, filename: String, attemptID: UUID? = nil) {
        self.batchID = batchID; self.itemID = itemID; self.filename = filename; self.attemptID = attemptID ?? itemID
    }
    private enum CodingKeys: String, CodingKey { case batchID, itemID, attemptID, filename }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        batchID = try c.decode(UUID.self, forKey: .batchID); itemID = try c.decode(UUID.self, forKey: .itemID)
        attemptID = try c.decodeIfPresent(UUID.self, forKey: .attemptID) ?? itemID
        filename = try c.decode(String.self, forKey: .filename)
    }
    public var taskDescription: String? { (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } }
    public init?(taskDescription: String?) {
        guard let value = taskDescription, let data = value.data(using: .utf8),
              let identity = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        self = identity
    }
}
