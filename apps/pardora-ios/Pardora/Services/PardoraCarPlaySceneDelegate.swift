@preconcurrency import CarPlay
import Foundation
import UIKit

@MainActor
final class PardoraCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate, CPNowPlayingTemplateObserver {
    private let model: RadioAppModel
    private let player: RadioPlayer
    private var interfaceController: CPInterfaceController?
    private var rootTemplate: CPListTemplate?
    private var rootRenderState = PardoraCarPlayRootRenderState()
    private var refreshTask: Task<Void, Never>?
    private var refreshLoopTask: Task<Void, Never>?

    override init() {
        model = RadioAppModel()
        player = RadioPlayer.shared
        super.init()
    }

    deinit {
        refreshTask?.cancel()
        refreshLoopTask?.cancel()
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        interfaceController.prefersDarkUserInterfaceStyle = true
        configureNowPlayingTemplate()

        refreshTask = Task { [weak self] in
            await self?.connect()
        }
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        refreshTask?.cancel()
        refreshLoopTask?.cancel()
        refreshTask = nil
        refreshLoopTask = nil
        rootTemplate = nil
        rootRenderState = PardoraCarPlayRootRenderState()
        self.interfaceController = nil
        player.setNextTrackHandler(nil)
        model.stopNetworkMonitoring()
        CPNowPlayingTemplate.shared.remove(self)
    }

    nonisolated func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        Task { @MainActor [weak self] in
            self?.showQueue()
        }
    }

    private func connect() async {
        model.startNetworkMonitoring()
        await refreshAndRender(animated: false)
        startRefreshLoop()
    }

    private func startRefreshLoop() {
        refreshLoopTask?.cancel()
        refreshLoopTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await self?.refreshAndRender(animated: false)
            }
        }
    }

    private func refreshAndRender(animated: Bool) async {
        guard PardoraSettings.isCarPlayModeEnabled() else {
            player.setNextTrackHandler(nil)
            renderRootTemplate(animated: animated)
            return
        }

        await model.refresh(showStatus: false)
        configurePlayer()
        renderRootTemplate(animated: animated)
    }

    private func configureNowPlayingTemplate() {
        let nowPlaying = CPNowPlayingTemplate.shared
        nowPlaying.isUpNextButtonEnabled = true
        nowPlaying.upNextTitle = "Queue"
        nowPlaying.add(self)
    }

    private func configurePlayer() {
        player.load(url: model.streamURL, metadata: RadioPlaybackMetadata(state: model.state))
        player.setNextTrackHandler { [weak self] in
            Task { @MainActor in
                await self?.skipTrack()
            }
        }
    }

    private func renderRootTemplate(animated: Bool) {
        let snapshot = PardoraCarPlayRootSnapshot(
            carPlayModeEnabled: PardoraSettings.isCarPlayModeEnabled(),
            state: model.state,
            statusMessage: model.statusMessage,
            isPlaying: player.isPlaying,
            hasStreamURL: model.streamURL != nil
        )
        guard rootRenderState.shouldRenderRootTemplate(for: snapshot) || rootTemplate == nil else {
            return
        }

        let sections = rootSections()
        if let rootTemplate {
            rootTemplate.updateSections(sections)
            updateRootTemplateActions(rootTemplate)
            return
        }

        let template = CPListTemplate(title: "Pardora", sections: sections)
        updateRootTemplateActions(template)
        rootTemplate = template
        interfaceController?.setRootTemplate(template, animated: animated) { _, _ in }
    }

    private func rootSections() -> [CPListSection] {
        guard PardoraSettings.isCarPlayModeEnabled() else {
            return [CPListSection(items: [carPlayDisabledItem()], header: "CarPlay", sectionIndexTitle: nil)]
        }

        var sections: [CPListSection] = []

        if let current = currentTrackItem() {
            sections.append(CPListSection(items: [current], header: "Now Playing", sectionIndexTitle: nil))
        } else {
            sections.append(CPListSection(items: [statusItem()], header: "Now Playing", sectionIndexTitle: nil))
        }

        if #available(iOS 26.0, *) {
            return sections
        }

        sections.append(CPListSection(items: controlItems(), header: "Controls", sectionIndexTitle: nil))
        return sections
    }

    private func updateRootTemplateActions(_ template: CPListTemplate) {
        if #available(iOS 26.0, *) {
            template.headerGridButtons = PardoraSettings.isCarPlayModeEnabled() ? rootGridButtons() : nil
        }
    }

    private func currentTrackItem() -> CPListItem? {
        guard let state = model.state, let track = state.currentTrack else {
            return nil
        }

        let item = CPListItem(text: track.title, detailText: "\(state.selectedStyleId.displayName) • \(state.queueStatusText)")
        item.isPlaying = player.isPlaying
        item.playbackProgress = CGFloat(player.progress.fraction)
        item.handler = { [weak self] _, completion in
            Task { @MainActor in
                self?.playCurrent()
                self?.showNowPlaying()
                completion()
            }
        }
        return item
    }

    private func statusItem() -> CPListItem {
        let detail = model.statusMessage ?? "Open Pardora on iPhone to connect to the radio server."
        let item = CPListItem(text: "Pardora Radio", detailText: detail)
        item.isEnabled = false
        return item
    }

    private func carPlayDisabledItem() -> CPListItem {
        let item = CPListItem(text: "CarPlay Mode Off", detailText: "Enable CarPlay Mode in Pardora Settings on iPhone.")
        item.isEnabled = false
        return item
    }

    private func controlItems() -> [CPListItem] {
        [
            controlItem(title: player.isPlaying ? "Pause" : "Play", detail: model.state?.currentTrack?.title) { [weak self] in
                self?.player.togglePlayback()
                self?.renderRootTemplate(animated: true)
            },
            controlItem(title: "Skip", detail: model.state?.nextUpTitleText) { [weak self] in
                await self?.skipTrack()
            },
            controlItem(title: "Thumbs Up", detail: "More like this") { [weak self] in
                await self?.rateCurrentTrack(up: true)
            },
            controlItem(title: "Thumbs Down", detail: "Less like this") { [weak self] in
                await self?.rateCurrentTrack(up: false)
            },
        ]
    }

    @available(iOS 26.0, *)
    private func rootGridButtons() -> [CPGridButton] {
        [
            rootGridButton(
                title: player.isPlaying ? "Pause" : "Play",
                systemImageName: player.isPlaying ? "pause.fill" : "play.fill",
                enabled: model.streamURL != nil
            ) { [weak self] in
                self?.player.togglePlayback()
                self?.renderRootTemplate(animated: true)
            },
            rootGridButton(title: "Skip", systemImageName: "forward.end.fill", enabled: model.state?.currentTrack != nil) { [weak self] in
                await self?.skipTrack()
            },
            rootGridButton(title: "Like", systemImageName: "hand.thumbsup.fill", enabled: model.state?.currentTrack != nil) { [weak self] in
                await self?.rateCurrentTrack(up: true)
            },
            rootGridButton(title: "Dislike", systemImageName: "hand.thumbsdown.fill", enabled: model.state?.currentTrack != nil) { [weak self] in
                await self?.rateCurrentTrack(up: false)
            },
        ]
    }

    @available(iOS 26.0, *)
    private func rootGridButton(
        title: String,
        systemImageName: String,
        enabled: Bool,
        action: @escaping @MainActor () async -> Void
    ) -> CPGridButton {
        let image = UIImage(systemName: systemImageName) ?? UIImage(systemName: "circle.fill")!
        let button = CPGridButton(titleVariants: [title], image: image) { _ in
            Task { @MainActor in
                await action()
            }
        }
        button.isEnabled = enabled
        return button
    }

    private func controlItem(
        title: String,
        detail: String?,
        action: @escaping @MainActor () async -> Void
    ) -> CPListItem {
        let item = CPListItem(text: title, detailText: detail)
        item.handler = { _, completion in
            Task { @MainActor in
                await action()
                completion()
            }
        }
        return item
    }

    private func queueTrackItems() -> [CPListItem] {
        guard let state = model.state else {
            return []
        }

        return state.selectedQueue.prefix(12).map { track in
            let item = CPListItem(text: track.title, detailText: track.createdDetailText())
            item.isPlaying = track.filename == state.currentTrack?.filename
            item.handler = { [weak self] _, completion in
                Task { @MainActor in
                    await self?.selectTrack(track)
                    completion()
                }
            }
            return item
        }
    }

    private func playCurrent() {
        configurePlayer()
        player.play()
        renderRootTemplate(animated: true)
    }

    private func skipTrack() async {
        await model.skipCurrentTrack()
        await model.refresh(showStatus: false)
        configurePlayer()
        player.play()
        renderRootTemplate(animated: true)
        showNowPlaying()
    }

    private func rateCurrentTrack(up: Bool) async {
        if up {
            await model.likeCurrentTrack()
        } else {
            await model.dislikeCurrentTrack()
        }
        configurePlayer()
        renderRootTemplate(animated: true)
    }

    private func selectTrack(_ track: RadioTrackRecord) async {
        await model.selectTrack(track)
        configurePlayer()
        player.play()
        renderRootTemplate(animated: true)
        showNowPlaying()
    }

    private func showNowPlaying() {
        let nowPlaying = CPNowPlayingTemplate.shared
        guard interfaceController?.topTemplate !== nowPlaying else {
            return
        }
        interfaceController?.pushTemplate(nowPlaying, animated: true) { _, _ in }
    }

    private func showQueue() {
        let template = CPListTemplate(title: "Queue", sections: [CPListSection(items: queueTrackItems(), header: nil, sectionIndexTitle: nil)])
        interfaceController?.pushTemplate(template, animated: true) { _, _ in }
    }
}

struct PardoraCarPlayRootRenderState {
    private var lastSnapshot: PardoraCarPlayRootSnapshot?

    mutating func shouldRenderRootTemplate(for snapshot: PardoraCarPlayRootSnapshot) -> Bool {
        guard lastSnapshot != snapshot else {
            return false
        }

        lastSnapshot = snapshot
        return true
    }
}

struct PardoraCarPlayRootSnapshot: Equatable {
    var carPlayModeEnabled: Bool
    var currentTrackID: String?
    var currentTrackFilename: String?
    var currentTrackTitle: String?
    var selectedStyleTitle: String?
    var queueStatusText: String?
    var statusMessage: String?
    var isPlaying: Bool
    var hasStreamURL: Bool
    var hasCurrentTrack: Bool
    var nextUpTitleText: String?

    init(
        carPlayModeEnabled: Bool,
        state: RadioStreamState?,
        statusMessage: String?,
        isPlaying: Bool,
        hasStreamURL: Bool
    ) {
        self.carPlayModeEnabled = carPlayModeEnabled
        currentTrackID = state?.currentTrack?.id
        currentTrackFilename = state?.currentTrack?.filename
        currentTrackTitle = state?.currentTrack?.title
        selectedStyleTitle = state?.selectedStyleId.displayName
        queueStatusText = state?.queueStatusText
        self.statusMessage = state?.currentTrack == nil ? statusMessage : nil
        self.isPlaying = isPlaying
        self.hasStreamURL = hasStreamURL
        hasCurrentTrack = state?.currentTrack != nil
        nextUpTitleText = state?.nextUpTitleText
    }
}
