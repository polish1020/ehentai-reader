import XCTest
@testable import ImageBatch

final class FileStorageTests: XCTestCase {
    private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5uoAAAAASUVORK5CYII=")!

    func testSuccessfulTransferIsValidatedAndWrittenToItemIsolatedLocation() throws {
        let identity = TransferIdentity(batchID: UUID(), itemID: UUID(), filename: "one.img")
        defer { try? FileManager.default.removeItem(at: FileStorage.folder(identity.batchID)) }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try png.write(to: temporary)
        let response = HTTPURLResponse(url: URL(string: "https://example.com/image")!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!
        let (name, bytes) = try FileStorage.accept(temporary, response: response, identity: identity)
        XCTAssertEqual(name, "one.png"); XCTAssertEqual(bytes, Int64(png.count))
        let destination = FileStorage.file(batchID: identity.batchID, itemID: identity.itemID, filename: name)
        XCTAssertEqual(try Data(contentsOf: destination), png)
        var item = DownloadItem(entry: DownloadEntry(url: URL(string: "https://example.com/image")!, filename: "one.img"))
        item.id = identity.itemID
        XCTAssertEqual(FileStorage.recovered(batchID: identity.batchID, item: item)?.0, "one.png")
        XCTAssertEqual(FileStorage.recovered(batchID: identity.batchID, item: item)?.1, Int64(png.count))
        try Data().write(to: destination)
        XCTAssertNil(FileStorage.recovered(batchID: identity.batchID, item: item))
        XCTAssertNotEqual(destination, FileStorage.file(batchID: identity.batchID, itemID: UUID(), filename: name))
        XCTAssertFalse(FileManager.default.fileExists(atPath: temporary.path))
    }

    func testHTTPFailuresAndHTMLCannotBecomeCompletedImages() throws {
        for (status, body, mime) in [(403, png, "image/png"), (200, Data("<html>Login required</html>".utf8), "text/html")] {
            let identity = TransferIdentity(batchID: UUID(), itemID: UUID(), filename: "bad.png")
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try body.write(to: temporary)
            defer { try? FileManager.default.removeItem(at: temporary); try? FileManager.default.removeItem(at: FileStorage.folder(identity.batchID)) }
            let response = HTTPURLResponse(url: URL(string: "https://example.com/image")!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": mime])!
            XCTAssertThrowsError(try FileStorage.accept(temporary, response: response, identity: identity))
            XCTAssertFalse(FileManager.default.fileExists(atPath: FileStorage.file(batchID: identity.batchID, itemID: identity.itemID, filename: identity.filename).path))
        }
    }
}
