import Foundation
import ImageIO
import UniformTypeIdentifiers

enum FileStorage {
    static let manager = FileManager.default
    static var stateURL: URL { manager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ImageBatch/tasks.json") }
    static var downloadsURL: URL { manager.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true) }
    static var exportsURL: URL { manager.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Exports", isDirectory: true) }

    static func folder(_ id: UUID) -> URL { downloadsURL.appendingPathComponent(id.uuidString, isDirectory: true) }
    static func file(batchID: UUID, itemID: UUID, filename: String) -> URL {
        folder(batchID).appendingPathComponent(itemID.uuidString, isDirectory: true).appendingPathComponent(ListImporter.safeFilename(filename))
    }
    static func prepare() throws {
        for directory in [stateURL.deletingLastPathComponent(), downloadsURL, exportsURL] {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        }
        for file in (try? manager.contentsOfDirectory(at: exportsURL, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
            if let date = try? file.resourceValues(forKeys: [.creationDateKey]).creationDate,
               date < Date().addingTimeInterval(-86_400) { try? manager.removeItem(at: file) }
        }
    }
    static func save(_ batches: [DownloadBatch]) throws {
        try prepare()
        let data = try JSONEncoder().encode(batches)
        try data.write(to: stateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func load() throws -> [DownloadBatch] {
        guard manager.fileExists(atPath: stateURL.path) else { return [] }
        return try JSONDecoder().decode([DownloadBatch].self, from: Data(contentsOf: stateURL))
    }

    /// Called synchronously inside didFinishDownloadingTo: its temporary URL
    /// ceases to exist when that delegate callback returns.
    static func accept(_ temporaryURL: URL, response: URLResponse?, identity: TransferIdentity) throws -> (String, Int64) {
        guard let http = response as? HTTPURLResponse else { throw TransferError.invalidResponse }
        guard (200...299).contains(http.statusCode) else { throw TransferError.http(http.statusCode) }
        let type = http.mimeType?.lowercased() ?? ""
        let source = CGImageSourceCreateWithURL(temporaryURL as CFURL, nil)
        var ext: String?
        if let source, CGImageSourceGetCount(source) > 0 {
            if let identifier = CGImageSourceGetType(source) { ext = UTType(identifier as String)?.preferredFilenameExtension }
        } else if type == "image/svg+xml" {
            let handle = try FileHandle(forReadingFrom: temporaryURL)
            defer { try? handle.close() }
            let prefix = try handle.read(upToCount: 8_192) ?? Data()
            guard let text = String(data: prefix, encoding: .utf8),
                  text.range(of: "<svg(?:\\s|>)", options: .regularExpression) != nil else { throw TransferError.notImage }
            ext = "svg"
        } else { throw TransferError.notImage }
        let size = (try manager.attributesOfItem(atPath: temporaryURL.path)[.size] as? NSNumber)?.int64Value ?? 0
        guard size > 0 else { throw TransferError.notImage }
        var name = ListImporter.safeFilename(identity.filename)
        if (name as NSString).pathExtension.lowercased() == "img", let ext {
            name = (name as NSString).deletingPathExtension + "." + ext
        }
        let directory = folder(identity.batchID).appendingPathComponent(identity.itemID.uuidString, isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let destination = file(batchID: identity.batchID, itemID: identity.itemID, filename: name)
        if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
        try manager.moveItem(at: temporaryURL, to: destination)
        try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
        var noBackup = destination
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? noBackup.setResourceValues(values)
        return (name, size)
    }
}

enum TransferError: LocalizedError {
    case invalidResponse, http(Int), notImage
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "服务器没有返回有效响应。"
        case .http(let code):
            return [401, 403, 404, 410].contains(code)
                ? "服务器返回 \(code)。链接可能已过期或需要权限，可导入新清单更新链接。"
                : "服务器返回 \(code)，请稍后重试。"
        case .notImage: return "下载内容不是可识别的图片，可能是错误页或登录页。"
        }
    }
}
