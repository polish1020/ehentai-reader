import SwiftUI
import UIKit

@main struct ImageBatchApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = DownloadStore.shared
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(store)
                .onChange(of: scenePhase) { _, phase in if phase == .background { store.persist() } }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        DownloadStore.shared.backgroundCompletion = completionHandler
        _ = DownloadStore.shared.session
    }
    func applicationDidEnterBackground(_ application: UIApplication) { DownloadStore.shared.persist() }
}
