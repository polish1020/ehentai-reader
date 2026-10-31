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
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 5 * 1024 * 1024 else { throw ImportError.tooLarge }
        let data = try Data(contentsOf: url)
        guard data.count <= 5 * 1024 * 1024 else { throw ImportError.tooLarge }
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

    private var parsed: ImportedList? {
        guard previewText == draft.text, previewName == draft.name else { return nil }
        return try? preview?.get()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("任务名称", text: $draft.name).accessibilityIdentifier("import-name")
                    TextEditor(text: $draft.text)
                        .focused($editing)
                        .font(.system(.body, design: .monospaced)).autocorrectionDisabled()
                        .textInputAutocapitalization(.never).frame(minHeight: 190)
                        .accessibilityLabel("图片链接或 JSON 清单").accessibilityIdentifier("import-text")
                    Button { showFilePicker = true } label: { Label("导入 TXT / JSON 文件", systemImage: "doc.badge.plus") }
                } header: { Text(draft.updating == nil ? "添加图片链接" : "更新任务链接") }
                footer: { Text("一行一条 HTTPS 图片直链，也支持 JSON 清单。最多 5,000 条、文件不超过 5 MB。") }
                if let preview {
                    Section {
                        switch preview {
                        case .success(let list):
                            Label("\(list.items.count) 张图片", systemImage: "photo.on.rectangle").accessibilityIdentifier("import-count")
                            if list.duplicateCount > 0 { Text("已忽略 \(list.duplicateCount) 条重复链接").foregroundStyle(.secondary) }
                            Text("下载器直接连接链接中的服务器，不需要账号。链接如果需要登录或已过期，下载可能失败。")
                                .font(.footnote).foregroundStyle(.secondary)
                            if draft.updating != nil { Text("按清单中的文件名更新链接，保留已下载文件。未包含在新清单中的未完成项目会停止。")
                                .font(.footnote).foregroundStyle(.secondary) }
                        case .failure(let failure): Text(failure.localizedDescription).foregroundStyle(.red).accessibilityIdentifier("import-error")
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
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
                        do { try store.add(list, updating: draft.updating); dismiss() }
                        catch { self.error = error.localizedDescription; busy = false }
                    } label: {
                        if busy { ProgressView() } else { Text(draft.updating == nil ? "开始下载" : "更新并下载") }
                    }.disabled(parsed == nil || busy || store.isRestoring).accessibilityIdentifier("import-start")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成输入") { editing = false }.accessibilityIdentifier("import-done-editing")
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
                do { let url = try result.get(); draft.text = try ImportFile.text(from: url); draft.name = url.deletingPathExtension().lastPathComponent; error = nil }
                catch { self.error = error.localizedDescription }
            }
        }
    }
}
