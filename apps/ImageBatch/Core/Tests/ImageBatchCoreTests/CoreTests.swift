import XCTest
@testable import ImageBatchCore

final class CoreTests: XCTestCase {
    func testTextImportDeduplicatesButPreservesSignedPathsAndQueries() throws {
        let signed = "https://images.example/a%2Fb/keystamp=123-abc/image.webp?token=a%2Bb&x=1"
        let list = try ListImporter.parse(Data("# export\n\(signed)\n\(signed)#preview\nhttps://other.example/two.png\n".utf8))
        XCTAssertEqual(list.items.count, 2)
        XCTAssertEqual(list.duplicateCount, 1)
        XCTAssertEqual(list.items[0].url.absoluteString, signed)
        XCTAssertEqual(list.items.map(\.filename), ["0001.webp", "0002.png"])
    }

    func testGenericJSONFormatsAndUnicodeFileNames() throws {
        let json = #"{"version":1,"name":"相片","items":[{"url":"https://example.com/a","filename":"../旅行/照片.jpg"},{"url":"https://example.com/b","filename":"..\\旅行\\照片.jpg"}]}"#
        let list = try ListImporter.parse(Data(json.utf8))
        XCTAssertEqual(list.name, "相片")
        XCTAssertEqual(list.items.map(\.filename), ["_旅行_照片.jpg", "_旅行_照片-2.jpg"])
        XCTAssertEqual(try ListImporter.parse(Data(#"["https://example.com/one.jpg"]"#.utf8)).items.count, 1)
        XCTAssertEqual(try ListImporter.parse(Data(#"[{"url":"https://example.com/one.jpg"}]"#.utf8)).items.count, 1)
        XCTAssertEqual(try ListImporter.parse(Data("\u{feff}https://example.com/a.jpg".utf8)).items.count, 1)
    }

    func testInvalidAndUnsupportedImportsFailClearly() {
        for value in ["", "file:///etc/passwd", "http://example.com/a.jpg", "javascript:alert(1)", "https://user:password@example.com/a", "{bad}", #"{"version":2,"items":[]}"#, "https://example.com/a.jpg\nnot a URL"] {
            XCTAssertThrowsError(try ListImporter.parse(Data(value.utf8)), value)
        }
        XCTAssertThrowsError(try ListImporter.parse(Data(repeating: 65, count: 5 * 1024 * 1024 + 1)))
        XCTAssertThrowsError(try ListImporter.parse(Data((0..<5_001).map { "https://example.com/\($0).jpg" }.joined(separator: "\n").utf8)))
        XCTAssertThrowsError(try ListImporter.parse(Data([0xff, 0xfe])))
    }

    func testDuplicateNamesUseCaseInsensitiveCollisionHandlingAndBoundedLengths() throws {
        let list = try ListImporter.parse(Data(#"{"items":[{"url":"https://e.example/1","filename":"A.JPG"},{"url":"https://e.example/2","filename":"a.jpg"}]}"#.utf8))
        XCTAssertEqual(list.items.map(\.filename), ["A.JPG", "a-2.jpg"])
        let name = ListImporter.safeFilename(String(repeating: "图", count: 300) + ".png")
        XCTAssertLessThan(name.utf8.count, 200)
        XCTAssertTrue(name.hasSuffix(".png"))
        XCTAssertFalse(ListImporter.safeFilename("../../").contains("/"))
    }

    func testRefreshingLinksPreservesCompletedImagesAndTaskSerialization() throws {
        var batch = DownloadBatch(list: try ListImporter.parse(Data(#"{"items":[{"url":"https://e.example/old1","filename":"1.jpg"},{"url":"https://e.example/old2","filename":"2.jpg"}]}"#.utf8)))
        batch.items[0].state = .completed
        batch.items[0].savedFilename = "1.jpg"
        batch.items[1].state = .failed
        let update = try ListImporter.parse(Data(#"{"items":[{"url":"https://e.example/new1","filename":"1.jpg"},{"url":"https://e.example/new2","filename":"2.jpg"},{"url":"https://e.example/new3","filename":"3.jpg"}]}"#.utf8))
        XCTAssertEqual(batch.updateLinks(update), 2)
        XCTAssertEqual(batch.items[0].url.absoluteString, "https://e.example/old1")
        XCTAssertEqual(batch.items[0].state, .completed)
        XCTAssertEqual(batch.items[1].url.absoluteString, "https://e.example/new2")
        XCTAssertEqual(batch.items[1].state, .waiting)
        let restored = try JSONDecoder().decode(DownloadBatch.self, from: JSONEncoder().encode(batch))
        XCTAssertEqual(restored.id, batch.id)
        XCTAssertEqual(restored.completedCount, 1)
        let identity = TransferIdentity(batchID: batch.id, itemID: batch.items[1].id, filename: "2.jpg")
        XCTAssertEqual(TransferIdentity(taskDescription: identity.taskDescription)?.itemID, batch.items[1].id)
        XCTAssertNil(TransferIdentity(taskDescription: "invalid"))
    }

    func testStreamingZIPCanBeReadBySystemUnzipIncludingUnicodeAndBinaryFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = directory.appendingPathComponent("图片.png"), second = directory.appendingPathComponent("second.webp")
        let bytes = Data((0..<200_000).map { UInt8($0 % 251) })
        try bytes.write(to: first); try Data("second image fixture".utf8).write(to: second)
        let zip = directory.appendingPathComponent("images.zip")
        try ZIPWriter.write([.init(url: first, name: "图片.png"), .init(url: second, name: "second.webp")], to: zip)
        let check = Process(); check.executableURL = URL(fileURLWithPath: "/usr/bin/unzip"); check.arguments = ["-t", zip.path]
        let checkPipe = Pipe(); check.standardOutput = checkPipe; check.standardError = checkPipe
        try check.run(); _ = checkPipe.fileHandleForReading.readDataToEndOfFile(); check.waitUntilExit()
        XCTAssertEqual(check.terminationStatus, 0)
        let extract = Process(); extract.executableURL = URL(fileURLWithPath: "/usr/bin/unzip"); extract.arguments = ["-p", zip.path, "图片.png"]
        let pipe = Pipe(); extract.standardOutput = pipe
        try extract.run(); let restored = pipe.fileHandleForReading.readDataToEndOfFile(); extract.waitUntilExit()
        XCTAssertEqual(extract.terminationStatus, 0); XCTAssertEqual(restored, bytes)
        XCTAssertThrowsError(try ZIPWriter.write([.init(url: first, name: "../bad.png")], to: directory.appendingPathComponent("bad.zip")))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("bad.zip").path))
    }
}
