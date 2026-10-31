import Foundation
import Photos
import ImageIO
import UniformTypeIdentifiers
import UIKit
import SwiftUI

struct DeliveryResult: Codable, Sendable {
    var kind: DestinationKind
    var filename: String
    var assetIdentifier: String?
}

enum DestinationError: LocalizedError {
    case permission, folder, format
    var errorDescription: String? {
        switch self {
        case .permission: return "没有添加照片的权限。请在系统设置中允许拾图添加照片，再重试保存；已下载图片会保留。"
        case .folder: return "无法访问所选目录，请确认文件服务已登录、目录可用。已下载图片会保留，重试时只重新保存。"
        case .format: return "系统相册不支持这张图片的格式。需要保留原始文件时，请使用文件目录保存。"
        }
    }
}

enum SaveDestinationWriter {
    static func authorizePhotos(requestIfNeeded: Bool = true) async throws {
        var status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if status == .notDetermined, requestIfNeeded { status = await PHPhotoLibrary.requestAuthorization(for: .addOnly) }
        guard status == .authorized || status == .limited else { throw DestinationError.permission }
    }

    static func bookmark(for url: URL) throws -> Data {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        return try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    static func withFolder<T>(_ destination: SaveDestination, _ body: (URL) throws -> T) throws -> T {
        guard let bookmark = destination.bookmark, let name = destination.subfolder,
              name == ListImporter.safeFilename(name) else { throw DestinationError.folder }
        var stale = false
        let root = try URL(resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)
        let access = root.startAccessingSecurityScopedResource()
        defer { if access { root.stopAccessingSecurityScopedResource() } }
        return try body(root.appendingPathComponent(name, isDirectory: true))
    }

    static func save(file: URL, destination: SaveDestination) async throws -> DeliveryResult {
        if destination.kind == .app {
            return DeliveryResult(kind: .app, filename: file.lastPathComponent)
        }
        if destination.kind == .folder {
            return try await Task.detached(priority: .utility) {
                try withFolder(destination) { directory in
                    var coordinationError: NSError?
                    var result: Result<String, Error>?
                    // Coordinate the selected parent: providers may need to create
                    // or materialize the task's subdirectory first.
                    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: directory.deletingLastPathComponent(), options: .forMerging, error: &coordinationError) { parent in
                        result = Result {
                            let folder = parent.appendingPathComponent(directory.lastPathComponent, isDirectory: true)
                            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                            var name = file.lastPathComponent, suffix = 2
                            let stem = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
                            while FileManager.default.fileExists(atPath: folder.appendingPathComponent(name).path) {
                                name = stem + "-\(suffix)" + (ext.isEmpty ? "" : "." + ext); suffix += 1
                            }
                            let temporary = folder.appendingPathComponent(".imagebatch-" + UUID().uuidString)
                            defer { try? FileManager.default.removeItem(at: temporary) }
                            try FileManager.default.copyItem(at: file, to: temporary)
                            try FileManager.default.moveItem(at: temporary, to: folder.appendingPathComponent(name))
                            return name
                        }
                    }
                    if let coordinationError { throw coordinationError }
                    guard let result else { throw DestinationError.folder }
                    return DeliveryResult(kind: .folder, filename: try result.get())
                }
            }.value
        }
        try await authorizePhotos(requestIfNeeded: false)
        let prepared = try await Task.detached(priority: .utility) { try photoCompatibleFile(file) }.value
        defer { if prepared != file { try? FileManager.default.removeItem(at: prepared) } }
        let box = AssetIDBox()
        let photoName = prepared == file ? file.lastPathComponent : file.deletingPathExtension().lastPathComponent + "." + prepared.pathExtension
        return try await withCheckedThrowingContinuation { continuation in
            PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = photoName
                request.addResource(with: .photo, fileURL: prepared, options: options)
                box.set(request.placeholderForCreatedAsset?.localIdentifier)
            } completionHandler: { success, error in
                if success { continuation.resume(returning: DeliveryResult(kind: .photos, filename: photoName, assetIdentifier: box.get())) }
                else { continuation.resume(throwing: error ?? DestinationError.format) }
            }
        }
    }

    static func photoCompatibleFile(_ file: URL) throws -> URL {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil), let identifier = CGImageSourceGetType(source) else { throw DestinationError.format }
        let type = identifier as String
        if [UTType.jpeg.identifier, UTType.png.identifier, UTType.heic.identifier, UTType.heif.identifier, UTType.gif.identifier, UTType.tiff.identifier].contains(type) { return file }
        // Photos does not consistently import WebP/AVIF across supported systems.
        // Keep source files untouched; create a bounded static JPEG for Photos.
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 8192,
            kCGImageSourceCreateThumbnailWithTransform: true
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw DestinationError.format }
        let destination = FileStorage.exportsURL.appendingPathComponent(UUID().uuidString + ".jpg")
        guard let writer = CGImageDestinationCreateWithURL(destination as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw DestinationError.format }
        CGImageDestinationAddImage(writer, image, [kCGImageDestinationLossyCompressionQuality: 0.95] as CFDictionary)
        guard CGImageDestinationFinalize(writer) else { try? FileManager.default.removeItem(at: destination); throw DestinationError.format }
        return destination
    }

    static func export(_ batch: DownloadBatch, to destination: URL, only itemID: UUID? = nil) throws -> URL {
        let selected = batch.items.filter { $0.state == .completed && (itemID == nil || $0.id == itemID) }
        guard batch.destination.kind != .photos else { throw DestinationError.permission }
        func write(from files: [(URL, String)]) throws -> URL {
            if itemID != nil {
                guard let first = files.first else { throw CocoaError(.fileNoSuchFile) }
                var error: NSError?
                var copy: Result<Void, Error>?
                NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: first.0, options: .withoutChanges, error: &error) { url in
                    copy = Result { try FileManager.default.copyItem(at: url, to: destination) }
                }
                if let error { throw error }
                try copy?.get(); return destination
            }
            try ZIPWriter.write(files.map { ZIPWriter.Entry(url: $0.0, name: $0.1) }, to: destination)
            return destination
        }
        if batch.destination.kind == .app {
            return try write(from: selected.map { (FileStorage.file(batchID: batch.id, itemID: $0.attemptID, filename: $0.savedFilename ?? $0.filename), $0.savedFilename ?? $0.filename) })
        }
        return try withFolder(batch.destination) { directory in
            let staging = destination.deletingLastPathComponent().appendingPathComponent("sources", isDirectory: true)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: staging) }
            var files: [(URL, String)] = []
            for item in selected {
                let name = item.savedFilename ?? item.filename
                let local = staging.appendingPathComponent(item.id.uuidString)
                var error: NSError?
                var copied: Result<Void, Error>?
                NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: directory.appendingPathComponent(name), options: .withoutChanges, error: &error) { source in
                    copied = Result { try FileManager.default.copyItem(at: source, to: local) }
                }
                if let error { throw error }
                guard let copied else { throw DestinationError.folder }; try copied.get()
                files.append((local, name))
            }
            return try write(from: files)
        }
    }
}

private final class AssetIDBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    func set(_ value: String?) { lock.lock(); self.value = value; lock.unlock() }
    func get() -> String? { lock.lock(); defer { lock.unlock() }; return value }
}

struct FolderPicker: UIViewControllerRepresentable {
    var completion: (Result<URL, Error>) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.allowsMultipleSelection = false; picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let completion: (Result<URL, Error>) -> Void
        init(completion: @escaping (Result<URL, Error>) -> Void) { self.completion = completion }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            if let url = urls.first { completion(.success(url)) }
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            completion(.failure(CocoaError(.userCancelled)))
        }
    }
}
