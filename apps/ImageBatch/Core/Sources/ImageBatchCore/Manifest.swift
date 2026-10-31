import Foundation

public struct DownloadEntry: Codable, Equatable, Sendable {
    public var id: String? = nil
    public var url: URL
    public var filename: String
}

public struct ImportedList: Equatable, Sendable {
    public var name: String
    public var items: [DownloadEntry]
    public var duplicateCount: Int
}

public enum ImportError: LocalizedError {
    case empty, tooLarge, tooMany, invalidText, version, invalidURL(Int), invalidJSON, duplicateID
    public var errorDescription: String? {
        switch self {
        case .empty: return "清单中没有图片链接。"
        case .tooLarge: return "清单不能超过 5 MB。"
        case .tooMany: return "一个任务最多导入 5,000 条链接，请分批导入。"
        case .invalidText: return "请导入 UTF-8 编码的 TXT 或 JSON 文件。"
        case .version: return "暂不支持这个清单版本。"
        case .invalidURL(let line): return "第 \(line) 条不是有效的 HTTPS 链接，或包含用户名、密码。"
        case .invalidJSON: return "JSON 格式不正确，请使用 items 数组，或直接使用链接数组。"
        case .duplicateID: return "清单中的 id 必须唯一，且不能超过 256 字节。"
        }
    }
}

public enum ListImporter {
    private struct Manifest: Decodable {
        var version: Int?
        var name: String?
        var items: [Item]
    }
    private struct Item: Decodable {
        var id: String? = nil
        var url: String
        var filename: String?
    }

    public static func parse(_ data: Data, defaultName: String = "图片任务") throws -> ImportedList {
        guard data.count <= 5 * 1024 * 1024 else { throw ImportError.tooLarge }
        guard let text = String(data: data, encoding: .utf8) else { throw ImportError.invalidText }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{feff}")))
        guard !trimmed.isEmpty else { throw ImportError.empty }
        var name = defaultName
        let raw: [Item]
        if trimmed.hasPrefix("{") || trimmed.hasPrefix("[") {
            let json = Data(trimmed.utf8), decoder = JSONDecoder()
            if trimmed.hasPrefix("{") {
                guard let manifest = try? decoder.decode(Manifest.self, from: json) else { throw ImportError.invalidJSON }
                guard manifest.version == nil || manifest.version == 1 else { throw ImportError.version }
                if let title = manifest.name, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    name = String(title.prefix(100))
                }
                raw = manifest.items
            } else if let links = try? decoder.decode([String].self, from: json) {
                raw = links.map { Item(url: $0, filename: nil) }
            } else if let items = try? decoder.decode([Item].self, from: json) {
                raw = items
            } else { throw ImportError.invalidJSON }
        } else {
            raw = trimmed.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.hasPrefix("#") }.map { Item(url: $0, filename: nil) }
        }
        guard raw.count <= 5_000 else { throw ImportError.tooMany }
        var seen = Set<String>(), filenames = Set<String>(), identifiers = Set<String>(), items: [DownloadEntry] = []
        for (index, item) in raw.enumerated() {
            let value = item.url.trimmingCharacters(in: .whitespacesAndNewlines)
            guard var parts = URLComponents(string: value), parts.scheme?.lowercased() == "https",
                  let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil else {
                throw ImportError.invalidURL(index + 1)
            }
            parts.fragment = nil
            guard let url = parts.url else { throw ImportError.invalidURL(index + 1) }
            // Keep signed paths and query strings intact.
            guard seen.insert(url.absoluteString).inserted else { continue }
            let identifier = item.id?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let identifier, !identifier.isEmpty {
                guard identifier.utf8.count <= 256, identifiers.insert(identifier).inserted else { throw ImportError.duplicateID }
            }
            let fallback = String(format: "%04d", items.count + 1) + "." + imageExtension(url.pathExtension)
            let requested = item.filename?.isEmpty == false ? item.filename! : fallback
            let safe = safeFilename(requested)
            let ext = (safe as NSString).pathExtension
            let stem = (safe as NSString).deletingPathExtension
            var candidate = safe, suffix = 2
            while !filenames.insert(candidate.precomposedStringWithCanonicalMapping.lowercased()).inserted {
                candidate = stem + "-\(suffix)" + (ext.isEmpty ? "" : "." + ext); suffix += 1
            }
            items.append(DownloadEntry(id: identifier?.isEmpty == false ? identifier : nil, url: url, filename: candidate))
        }
        guard !items.isEmpty else { throw ImportError.empty }
        return ImportedList(name: String(name.prefix(100)), items: items, duplicateCount: raw.count - items.count)
    }

    public static func safeFilename(_ input: String) -> String {
        let forbidden = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\:?*\"<>|"))
        var value = input.components(separatedBy: forbidden).joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        if value.isEmpty { value = "image.img" }
        let ext = String((value as NSString).pathExtension.prefix(12))
        var stem = (value as NSString).deletingPathExtension
        while stem.utf8.count > 170 { stem.removeLast() }
        return stem + (ext.isEmpty ? "" : "." + ext)
    }

    private static func imageExtension(_ value: String) -> String {
        let ext = value.lowercased()
        return ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff", "svg"].contains(ext) ? ext : "img"
    }
}
