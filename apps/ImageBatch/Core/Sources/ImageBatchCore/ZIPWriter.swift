import Foundation

public enum ZIPError: LocalizedError {
    case tooLarge, invalidName
    public var errorDescription: String? {
        switch self {
        case .tooLarge: return "这批文件超过 ZIP 导出上限（4 GB 或 65,535 个文件），请分批分享。"
        case .invalidName: return "导出文件名不正确。"
        }
    }
}

/// A streaming, uncompressed ZIP writer. Never loads a whole image or archive into memory.
public enum ZIPWriter {
    public struct Entry: Sendable {
        public var url: URL
        public var name: String
        public init(url: URL, name: String) { self.url = url; self.name = name }
    }
    private struct Record { var name: Data; var extra: Data; var size: UInt32; var crc: UInt32; var offset: UInt32 }
    private static let table: [UInt32] = (0..<256).map { value in
        var crc = UInt32(value)
        for _ in 0..<8 { crc = crc & 1 == 1 ? (crc >> 1) ^ 0xedb88320 : crc >> 1 }
        return crc
    }

    public static func write(_ entries: [Entry], to destination: URL) throws {
        guard entries.count <= 65_535 else { throw ZIPError.tooLarge }
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let output = try FileHandle(forWritingTo: destination)
        defer { try? output.close() }
        var finished = false
        defer { if !finished { try? FileManager.default.removeItem(at: destination) } }
        var records: [Record] = []
        func append(_ data: Data) throws {
            guard try output.offset() + UInt64(data.count) <= UInt64(UInt32.max) else { throw ZIPError.tooLarge }
            try output.write(contentsOf: data)
        }
        for entry in entries {
            guard entry.name == ListImporter.safeFilename(entry.name) else { throw ZIPError.invalidName }
            let name = Data(entry.name.utf8)
            guard name.count <= Int(UInt16.max) else { throw ZIPError.invalidName }
            let input = try FileHandle(forReadingFrom: entry.url)
            defer { try? input.close() }
            var crc: UInt32 = 0xffffffff, size: UInt64 = 0
            while let chunk = try input.read(upToCount: 65_536), !chunk.isEmpty {
                size += UInt64(chunk.count)
                guard size <= UInt64(UInt32.max) else { throw ZIPError.tooLarge }
                for byte in chunk { crc = table[Int((crc ^ UInt32(byte)) & 0xff)] ^ (crc >> 8) }
            }
            // Include the Info-ZIP Unicode Path field as well as the UTF-8 flag
            // for readers which still interpret the legacy name as a code page.
            var nameCRC: UInt32 = 0xffffffff
            for byte in name { nameCRC = table[Int((nameCRC ^ UInt32(byte)) & 0xff)] ^ (nameCRC >> 8) }
            var extra = Data(); extra.le(UInt16(0x7075)); extra.le(UInt16(5 + name.count))
            extra.append(1); extra.le(nameCRC ^ 0xffffffff); extra.append(name)
            let record = Record(name: name, extra: extra, size: UInt32(size), crc: crc ^ 0xffffffff, offset: UInt32(try output.offset()))
            var header = Data()
            header.le(UInt32(0x04034b50)); header.le(UInt16(20)); header.le(UInt16(0x0800))
            header.le(UInt16(0)); header.le(UInt16(0)); header.le(UInt16(0x0021))
            header.le(record.crc); header.le(record.size); header.le(record.size)
            header.le(UInt16(name.count)); header.le(UInt16(extra.count)); header.append(name); header.append(extra)
            try append(header); try input.seek(toOffset: 0)
            while let chunk = try input.read(upToCount: 65_536), !chunk.isEmpty { try append(chunk) }
            records.append(record)
        }
        let centralStart = try output.offset()
        for record in records {
            var header = Data()
            header.le(UInt32(0x02014b50)); header.le(UInt16(20)); header.le(UInt16(20)); header.le(UInt16(0x0800))
            header.le(UInt16(0)); header.le(UInt16(0)); header.le(UInt16(0x0021))
            header.le(record.crc); header.le(record.size); header.le(record.size)
            header.le(UInt16(record.name.count)); header.le(UInt16(record.extra.count)); header.le(UInt16(0))
            header.le(UInt16(0)); header.le(UInt16(0)); header.le(UInt32(0)); header.le(record.offset)
            header.append(record.name); header.append(record.extra); try append(header)
        }
        let centralSize = try output.offset() - centralStart
        var end = Data()
        end.le(UInt32(0x06054b50)); end.le(UInt16(0)); end.le(UInt16(0))
        end.le(UInt16(records.count)); end.le(UInt16(records.count)); end.le(UInt32(centralSize)); end.le(UInt32(centralStart)); end.le(UInt16(0))
        try append(end); try output.synchronize(); finished = true
    }
}

private extension Data {
    mutating func le<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }
}
