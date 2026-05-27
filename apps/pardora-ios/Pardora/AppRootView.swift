import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case now
    case queue
    case memory
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .now: "Now"
        case .queue: "Queue"
        case .memory: "Memory"
        case .settings: "Settings"
        }
    }

    var symbolName: String {
        switch self {
        case .now: "play.circle.fill"
        case .queue: "music.note.list"
        case .memory: "brain.head.profile"
        case .settings: "gearshape.fill"
        }
    }
}

struct AppRootView: View {
    @State private var selectedTab: AppTab = .now
    @State private var model = RadioAppModel()

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack {
                    switch tab {
                    case .now:
                        NowPlayingView(model: model)
                    case .queue:
                        QueueView(model: model)
                    case .memory:
                        MemoryView(model: model)
                    case .settings:
                        SettingsView(model: model)
                    }
                }
                .tabItem {
                    Label(tab.title, systemImage: tab.symbolName)
                }
                .tag(tab)
            }
        }
        .tint(PardoraTheme.accent)
        .task {
            model.startNetworkMonitoring()
            await model.refresh()
        }
    }
}

#Preview {
    AppRootView()
}
