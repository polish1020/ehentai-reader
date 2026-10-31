import XCTest
@testable import ImageBatch

final class FileStorageTests: XCTestCase {
    private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5uoAAAAASUVORK5CYII=")!

    func testImportFileLargerThanFiveMiBPreservesItsFullContents() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("large-manifest.json")
        let text = #"{"items":[{"url":"https://example.com/large.png"}]}"#
            + String(repeating: " ", count: 5 * 1024 * 1024)
        let data = Data(text.utf8)
        XCTAssertGreaterThan(data.count, 5 * 1024 * 1024)
        try data.write(to: file)

        let imported = try ImportFile.text(from: file)
        XCTAssertEqual(imported, text)
        let list = try ListImporter.parse(Data(imported.utf8))
        XCTAssertEqual(list.items.count, 1)
        XCTAssertEqual(list.items[0].url.absoluteString, "https://example.com/large.png")
    }

    @MainActor func testSessionDoesNotUseBrowserCookiesOrStoredCredentials() {
        let configuration = DownloadStore.shared.session.configuration
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertNil(configuration.urlCredentialStorage)
        XCTAssertFalse(configuration.httpShouldSetCookies)
        XCTAssertEqual(configuration.httpMaximumConnectionsPerHost, 3)
    }

    func testWebPDownloadsAreRecognizedWithoutSiteSpecificHandling() throws {
        let bytes = Data(base64Encoded: "UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQu9ZUrf+BiOh/AAA=")!
        let identity = TransferIdentity(batchID: UUID(), itemID: UUID(), filename: "two.img")
        defer { try? FileManager.default.removeItem(at: FileStorage.folder(identity.batchID)) }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try bytes.write(to: temporary)
        let response = HTTPURLResponse(url: URL(string: "https://example.com/image")!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/webp"])!
        let (name, count) = try FileStorage.accept(temporary, response: response, identity: identity)
        XCTAssertEqual(name, "two.webp"); XCTAssertEqual(count, Int64(bytes.count))
    }

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
        item.id = identity.itemID; item.attemptID = identity.attemptID
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

    func testFolderBookmarkWritesOriginalFileWithoutOverwritingExistingImages() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.png"); try png.write(to: source)
        let target = SaveDestination(kind: .folder, bookmark: try SaveDestinationWriter.bookmark(for: root), label: "Test", subfolder: "images")
        let first = try await SaveDestinationWriter.save(file: source, destination: target)
        let second = try await SaveDestinationWriter.save(file: source, destination: target)
        XCTAssertEqual(first.filename, "source.png"); XCTAssertEqual(second.filename, "source-2.png")
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("images/source.png")), png)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("images/source-2.png")), png)
        XCTAssertEqual(try Data(contentsOf: source), png)
    }

    func testWebPConversionForPhotosKeepsOriginalUntouched() throws {
        try FileStorage.prepare()
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".webp")
        let data = Data(base64Encoded: "UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQu9ZUrf+BiOh/AAA=")!
        try data.write(to: source)
        let compatible = try SaveDestinationWriter.photoCompatibleFile(source)
        defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: compatible) }
        XCTAssertEqual(compatible.pathExtension, "jpg")
        XCTAssertNotEqual(source, compatible)
        XCTAssertEqual(try Data(contentsOf: source), data)
        XCTAssertGreaterThan(try Data(contentsOf: compatible).count, 0)
    }
}
