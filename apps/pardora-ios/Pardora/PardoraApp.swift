import SwiftUI

@main
struct PardoraApp: App {
    init() {
        PardoraWatchConnectivityController.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
        }
    }
}
