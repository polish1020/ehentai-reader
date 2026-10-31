import SwiftUI

struct SharePayload: Identifiable { let id = UUID(); var urls: [URL] }

struct ContentView: View {
    @EnvironmentObject private var store: DownloadStore
    @State private var draft: ImportDraft?
    @State private var showAbout = false
    var body: some View {
        NavigationStack {
            Group {
                if store.batches.isEmpty {
                    ContentUnavailableView {
                        Label("把图片留在本机", systemImage: "arrow.down.circle")
                    } description: {
                        Text("粘贴图片链接，或导入 TXT / JSON 清单。\n直接下载到设备，随时导出分享。")
                    } actions: {
                        Button("新建下载") { draft = ImportDraft() }.buttonStyle(.borderedProminent).accessibilityIdentifier("new-download")
                    }
                } else {
                    List {
                        ForEach(store.batches) { batch in
                            NavigationLink(value: batch.id) { BatchRow(batch: batch) }
                        }.onDelete { offsets in
                            let ids = offsets.map { store.batches[$0].id }
                            ids.forEach(store.delete)
                        }
                    }
                }
            }
            .navigationTitle("拾图")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button { showAbout = true } label: { Image(systemName: "info.circle") }.accessibilityLabel("使用说明与隐私") }
                ToolbarItem(placement: .topBarTrailing) { Button { draft = ImportDraft() } label: { Image(systemName: "plus") }.accessibilityLabel("新建下载").accessibilityIdentifier("new-download-toolbar") }
            }
            .navigationDestination(for: UUID.self) { BatchDetailView(batchID: $0) }
            .sheet(item: $draft) { ImportView(draft: $0).environmentObject(store) }
            .sheet(isPresented: $showAbout) { AboutView() }
            .onOpenURL { url in
                do { draft = ImportDraft(text: try ImportFile.text(from: url), name: url.deletingPathExtension().lastPathComponent) }
                catch { store.notice = error.localizedDescription }
            }
            .alert("提示", isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })) {
                Button("好") { store.notice = nil }
            } message: { Text(store.notice ?? "") }
        }.tint(.teal)
    }
}

private struct BatchRow: View {
    let batch: DownloadBatch
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Image(systemName: batch.completedCount == batch.items.count ? "checkmark.circle.fill" : "photo.stack").foregroundStyle(.teal)
                Text(batch.name).font(.headline).lineLimit(1)
                Spacer()
                if batch.isActive { ProgressView().controlSize(.small) }
            }
            HStack {
                Text("\(batch.completedCount) / \(batch.items.count) 张已下载")
                if batch.failedCount > 0 { Text("· \(batch.failedCount) 张失败").foregroundStyle(.orange) }
            }.font(.caption).foregroundStyle(.secondary)
            Text(batch.destination.kind == .photos ? "保存到相册" : batch.destination.kind == .folder ? "保存到目录 · \(batch.destination.label ?? "所选目录")" : "保存在应用内")
                .font(.caption2).foregroundStyle(.secondary)
            ProgressView(value: Double(batch.completedCount), total: Double(max(1, batch.items.count))).tint(.teal)
        }.padding(.vertical, 7)
    }
}

struct BatchDetailView: View {
    @EnvironmentObject private var store: DownloadStore
    let batchID: UUID
    @State private var draft: ImportDraft?
    @State private var share: SharePayload?
    @State private var exporting = false
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss
    private var batch: DownloadBatch? { store.batches.first { $0.id == batchID } }

    var body: some View {
        Group {
            if let batch {
                List {
                    Section {
                        BatchRow(batch: batch)
                        if batch.items.contains(where: { $0.state == .failed || $0.state == .cancelled }) {
                            Button { store.retry(batchID) } label: { Label("重试未完成图片", systemImage: "arrow.clockwise") }
                        }
                        if batch.isActive {
                            Button(role: .destructive) { store.cancel(batchID) } label: { Label("停止未完成下载", systemImage: "stop.circle") }
                        }
                    }
                    Section("图片") {
                        ForEach(batch.items) { item in
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(spacing: 12) {
                                    Image(systemName: symbol(item.state)).foregroundStyle(color(item.state)).frame(width: 23)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(item.savedFilename ?? item.filename).font(.subheadline).lineLimit(1)
                                        Text(item.url.host ?? "").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Spacer(minLength: 0)
                                    if item.state == .completed {
                                        if batch.destination.kind == .app {
                                            ShareLink(item: store.fileURL(batchID: batchID, item: item)) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("分享 \(item.filename)")
                                        } else if batch.destination.kind == .folder {
                                            Button {
                                                exporting = true
                                                Task {
                                                    do { share = SharePayload(urls: [try await store.export(batchID, itemID: item.id)]) }
                                                    catch { store.notice = error.localizedDescription }
                                                    exporting = false
                                                }
                                            } label: { Image(systemName: "square.and.arrow.up") }.buttonStyle(.borderless).disabled(exporting).accessibilityLabel("分享 \(item.filename)")
                                        }
                                    } else if item.state == .failed || item.state == .cancelled {
                                        Button { store.retry(batchID, itemID: item.id) } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.borderless).accessibilityLabel("重试 \(item.filename)")
                                    }
                                }
                                if item.state == .downloading {
                                    if item.expected > 0 { ProgressView(value: Double(item.received), total: Double(max(item.received, item.expected))) }
                                    Text("正在下载 · \(ByteCountFormatter.string(fromByteCount: item.received, countStyle: .file))").font(.caption).foregroundStyle(.secondary)
                                } else if item.state == .saving {
                                    HStack { ProgressView().controlSize(.small); Text("正在保存到目标位置…").font(.caption).foregroundStyle(.secondary) }
                                } else if let error = item.error { Text(error).font(.caption).foregroundStyle(.red) }
                                else { Text(item.state == .completed && batch.destination.kind == .photos ? "已存入相册" : item.state == .completed && batch.destination.kind == .folder ? "已保存到所选目录" : label(item.state)).font(.caption).foregroundStyle(.secondary) }
                            }.padding(.vertical, 5)
                        }
                    }
                }.navigationTitle(batch.name).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        if exporting { ProgressView() }
                        else {
                            Menu {
                                Button { draft = ImportDraft(name: batch.name, updating: batchID) } label: { Label("导入更新链接", systemImage: "link.badge.plus") }
                                Button {
                                    exporting = true
                                    Task {
                                        do { share = SharePayload(urls: [try await store.export(batchID)]) }
                                        catch { store.notice = error.localizedDescription }
                                        exporting = false
                                    }
                                } label: { Label("导出已下载图片 ZIP", systemImage: "doc.zipper") }.disabled(batch.completedCount == 0 || batch.destination.kind == .photos)
                                Button(role: .destructive) { confirmDelete = true } label: { Label("移除任务", systemImage: "trash") }
                            } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("任务选项")
                        }
                    }
                }
            } else { ContentUnavailableView("任务已移除", systemImage: "tray") }
        }
        .sheet(item: $draft) { ImportView(draft: $0).environmentObject(store) }
        .sheet(item: $share) { ActivityView(urls: $0.urls) }
        .confirmationDialog(batch?.destination.kind == .app ? "删除任务和应用内图片？" : "移除任务和临时文件？已保存到外部目录或相册的图片会保留。", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("删除", role: .destructive) { store.delete(batchID); if !store.batches.contains(where: { $0.id == batchID }) { dismiss() } }
        }
    }
    private func symbol(_ state: ItemState) -> String {
        switch state { case .waiting: return "clock"; case .downloading: return "arrow.down.circle"; case .saving: return "square.and.arrow.down"; case .completed: return "checkmark.circle.fill"; case .failed: return "exclamationmark.circle"; case .cancelled: return "stop.circle" }
    }
    private func color(_ state: ItemState) -> Color {
        switch state { case .completed: return .teal; case .failed: return .orange; default: return .secondary }
    }
    private func label(_ state: ItemState) -> String {
        switch state { case .waiting: return "等待下载"; case .downloading: return "正在下载"; case .saving: return "正在保存"; case .completed: return "已保存到本机"; case .failed: return "下载失败"; case .cancelled: return "已停止" }
    }
}

private struct ActivityView: UIViewControllerRepresentable {
    let urls: [URL]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private struct AboutView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("如何使用") {
                    Text("新建任务后粘贴链接，或通过“文件”App 选择 TXT / JSON 清单并用拾图打开。下载完成后，可分享单张图片或将已下载图片导出为 ZIP。")
                    Text("链接有时效时，请尽快下载。可在任务菜单导入新清单，优先按 id、否则按文件名更新未完成项目；已完成图片不会重新下载。后台下载由 iOS 调度；强制退出 App、网络中断或链接过期可能使任务停止。")
                }
                Section("隐私说明") {
                    Text("链接、任务记录和图片保存在本机。本应用不注册账号、不包含广告或分析 SDK，不向开发者服务器上传这些数据。")
                    Text("下载会直接连接你提供的服务器，对方可以看到设备的网络地址和请求的链接。本应用不会附带浏览器 Cookie 或账号凭证。")
                    Text("应用内下载图片不进入 iCloud 设备备份；导入链接和任务记录可能随系统备份保存。选择 iCloud Drive 或其他文件服务时，图片由对应服务同步。移除任务只删除应用内图片和临时文件；外部目录、相册以及分享的副本需要你自行管理。")
                }
                Section("支持范围") {
                    Text("支持可直接访问的 HTTPS 图片链接，不解析网页。相册模式仅请求添加照片权限，不读取已有相片；部分不兼容格式会转换为静态 JPEG，保存到目录可保留源文件。请下载你拥有权利或获得授权的图片。服务端权限、有效期、限流和网络可达性仍然适用。")
                }
            }.navigationTitle("使用说明与隐私").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}
