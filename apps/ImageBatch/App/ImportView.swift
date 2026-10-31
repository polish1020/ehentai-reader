import SwiftUI
import UniformTypeIdentifiers

struct ImportDraft: Identifiable {
    let id = UUID()
    var text = ""
    var name = "图片任务"
    var updating: UUID?
}

enum ImportFile {
    static func text(from url: URL) throws -> String {
        guard url.isFileURL else { throw ImportError.invalidText }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        guard let text = String(data: data, encoding: .utf8) else { throw ImportError.invalidText }
        return text
    }
}

struct ImportView: View {
    @EnvironmentObject private var store: DownloadStore
    @Environment(\.dismiss) private var dismiss
    @State var draft: ImportDraft
    @State private var showFilePicker = false
    @State private var error: String?
    @State private var busy = false
    @FocusState private var editing: Bool
    @State private var preview: Result<ImportedList, Error>?
    @State private var previewText = ""
    @State private var previewName = ""
    @State private var saveKind: DestinationKind = .app
    @State private var folderBookmark: Data?
    @State private var folderName = ""
    @State private var showFolderPicker = false
    @State private var isManifestExpanded: Bool

    init(draft: ImportDraft) {
        _draft = State(initialValue: draft)
        _isManifestExpanded = State(initialValue: draft.text.isEmpty)
    }

    private var parsed: ImportedList? {
        guard previewText == draft.text, previewName == draft.name else { return nil }
        return try? preview?.get()
    }

    private func toggleManifest() {
        if isManifestExpanded { editing = false }
        isManifestExpanded.toggle()
    }

    private func collapseManifest() {
        editing = false
        isManifestExpanded = false
    }

    var body: some View {
        NavigationStack {
            Form {
                if !store.batches.isEmpty {
                    Section("导入方式") {
                        Picker("任务", selection: $draft.updating) {
                            Text("新建任务").tag(UUID?.none)
                            ForEach(store.batches) { batch in
                                Text("继续 · \(batch.name)").tag(Optional(batch.id))
                            }
                        }
                        .onChange(of: draft.updating) { _, value in
                            if let batch = store.batches.first(where: { $0.id == value }) { draft.name = batch.name }
                        }
                        if let batch = store.batches.first(where: { $0.id == draft.updating }) {
                            Text(batch.destination.kind == .photos ? "沿用原任务：保存到相册" : batch.destination.kind == .folder ? "沿用原任务目录：\(batch.destination.label ?? "所选目录")" : "沿用原任务：保存在应用内")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("任务设置") {
                    TextField("任务名称", text: $draft.name).accessibilityIdentifier("import-name")
                }
                if let preview {
                    Section("清单预览") {
                        switch preview {
                        case .success(let list):
                            Label("\(list.items.count) 张图片", systemImage: "photo.on.rectangle").accessibilityIdentifier("import-count")
                            if list.duplicateCount > 0 { Text("已忽略 \(list.duplicateCount) 条重复链接").foregroundStyle(.secondary) }
                            Text("下载器直接连接链接中的服务器，不需要账号。链接如果需要登录或已过期，下载可能失败。")
                                .font(.footnote).foregroundStyle(.secondary)
                            if draft.updating != nil { Text("优先按 id、否则按文件名更新链接；保留已完成图片和下载进度。TXT 更新时请保持原顺序，JSON 建议保留稳定 id。已下载、待保存的图片只重试保存。未包含在新清单中的未完成项目会停止。")
                                .font(.footnote).foregroundStyle(.secondary) }
                        case .failure(let failure): Text(failure.localizedDescription).foregroundStyle(.red).accessibilityIdentifier("import-error")
                        }
                    }
                }
                if let error { Section("错误") { Text(error).foregroundStyle(.red) } }
                if draft.updating == nil {
                    Section("保存位置") {
                        Picker("保存到", selection: $saveKind) {
                            Text("应用内").tag(DestinationKind.app)
                            Text("文件目录 / iCloud Drive").tag(DestinationKind.folder)
                            Text("系统相册").tag(DestinationKind.photos)
                        }.accessibilityIdentifier("save-destination")
                        if saveKind == .folder {
                            Button { showFolderPicker = true } label: {
                                Label(folderName.isEmpty ? "选择保存目录" : folderName, systemImage: "folder")
                            }
                            Text("可选择“文件”中的本机、iCloud Drive 或其他支持目录访问的文件服务。将在所选目录下为任务创建子文件夹；云端同步由系统处理。")
                                .font(.footnote).foregroundStyle(.secondary)
                        } else if saveKind == .photos {
                            Text("只申请添加照片权限，不读取已有相片。WebP / AVIF 等不兼容格式会转换为静态 JPEG（最长边最多 8192 像素）；需要保留源文件时请选择文件目录。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    Button(action: toggleManifest) {
                        HStack {
                            Text(isManifestExpanded ? "收起清单内容" : "展开清单内容")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .rotationEffect(.degrees(isManifestExpanded ? 90 : 0))
                                .foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("import-manifest-toggle")
                    .accessibilityValue(isManifestExpanded ? "已展开" : "已收起")
                    if isManifestExpanded {
                        TextEditor(text: $draft.text)
                            .focused($editing)
                            .font(.system(.body, design: .monospaced)).autocorrectionDisabled()
                            .textInputAutocapitalization(.never).frame(height: 200)
                            .accessibilityLabel("图片链接或 JSON 清单").accessibilityIdentifier("import-text")
                    }
                    Button { showFilePicker = true } label: { Label("导入 TXT / JSON 文件", systemImage: "doc.badge.plus") }
                } header: { Text("链接清单") }
                footer: { Text("一行一条 HTTPS 图片直链，也支持 JSON 清单。最多 5,000 条。") }
            }
            .navigationTitle(draft.updating == nil ? "新建下载" : "更新链接")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        guard var list = parsed else { return }
                        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !name.isEmpty { list.name = String(name.prefix(100)) }
                        busy = true
                        Task {
                            do {
                                let destination = store.batches.first(where: { $0.id == draft.updating })?.destination ?? SaveDestination(kind: saveKind, bookmark: folderBookmark, label: folderName)
                                if destination.kind == .photos { try await SaveDestinationWriter.authorizePhotos() }
                                try store.add(list, updating: draft.updating, destination: destination); dismiss()
                            } catch { self.error = error.localizedDescription; busy = false }
                        }
                    } label: {
                        if busy { ProgressView() } else { Text(draft.updating == nil ? "开始下载" : "更新并下载") }
                    }.disabled(parsed == nil || busy || store.isRestoring || (draft.updating == nil && saveKind == .folder && folderBookmark == nil)).accessibilityIdentifier("import-start")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成输入") { collapseManifest() }.accessibilityIdentifier("import-done-editing")
                }
            }
            .task(id: draft.name + "\u{0}" + draft.text) {
                preview = nil
                guard !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                do { try await Task.sleep(for: .milliseconds(150)) } catch { return }
                let text = draft.text, name = draft.name
                let result = await Task.detached(priority: .userInitiated) {
                    Result { try ListImporter.parse(Data(text.utf8), defaultName: name) }
                }.value
                guard !Task.isCancelled else { return }
                previewText = text; previewName = name
                preview = result
                if name == "图片任务", case .success(let list) = result, list.name != name { draft.name = list.name }
            }
            .fileImporter(isPresented: $showFilePicker, allowedContentTypes: [.json, .plainText]) { result in
                do {
                    let url = try result.get()
                    draft.text = try ImportFile.text(from: url)
                    draft.name = url.deletingPathExtension().lastPathComponent
                    error = nil
                    collapseManifest()
                }
                catch { self.error = error.localizedDescription }
            }
            .sheet(isPresented: $showFolderPicker) {
                FolderPicker { result in
                    do {
                        let url = try result.get(); folderBookmark = try SaveDestinationWriter.bookmark(for: url)
                        folderName = url.lastPathComponent; error = nil
                    } catch { if (error as? CocoaError)?.code != .userCancelled { self.error = error.localizedDescription } }
                    showFolderPicker = false
                }
            }
        }
    }
}
