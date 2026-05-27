import SwiftUI

struct NowPlayingView: View {
    var model: RadioAppModel
    @AppStorage(PardoraSettings.autoPlayOnLaunchKey) private var autoPlayOnLaunch = false
    @State private var player = RadioPlayer.shared
    @State private var didAttemptLaunchAutoPlay = false

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    stationHeader
                    trackCard
                    statusStack
                }
                .frame(width: max(0, geometry.size.width - 36), alignment: .leading)
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .padding(.bottom, 126)
            }
        }
        .navigationTitle("Now")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await model.refresh()
        }
        .safeAreaInset(edge: .bottom) {
            playbackControls
        }
        .task(id: playbackIdentity) {
            player.setNextTrackHandler {
                Task { await model.skipCurrentTrack() }
            }
            player.load(url: model.streamURL, metadata: RadioPlaybackMetadata(state: model.state))
            if autoPlayOnLaunch, !didAttemptLaunchAutoPlay, model.streamURL != nil {
                didAttemptLaunchAutoPlay = true
                player.play()
            }
        }
        .task(id: progressIdentity) {
            await updateProgressLoop()
        }
    }

    private var stationHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pardora")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            HStack(spacing: 8) {
                playbackPill
                queuePill
            }

            nextUpTitle(title: model.state?.nextUpTitleText ?? "Loading station")

            styleMenu
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var trackCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            AutoScrollingText(
                model.state?.currentTrack?.title ?? "No song loaded",
                font: .title2.bold(),
                foregroundStyle: .primary,
                height: 34
            )
            .accessibilityLabel(model.state?.currentTrack?.title ?? "No song loaded")

            if player.progress.durationSeconds != nil {
                TrackProgressView(progress: player.progress)
            } else {
                Text("Duration unavailable")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }

    private var statusStack: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let status = model.statusMessage {
                StatusBanner(text: status, tone: .warning)

                if status == RadioAppModel.cloudflareVPNMessage {
                    CloudflareOneButton()
                        .buttonStyle(.bordered)
                }
            }

            if let playbackStatus = visiblePlaybackStatus {
                StatusBanner(text: playbackStatus, tone: .warning)
            }
        }
    }

    private var playbackPill: some View {
        HStack(spacing: 6) {
            Image(systemName: player.isPlaying ? "waveform" : "play.fill")
                .font(.caption.weight(.bold))
            Text(player.isPlaying ? "Playing" : "Ready")
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(player.isPlaying ? PardoraTheme.accent : .secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: Capsule())
    }

    private var queuePill: some View {
        HStack(spacing: 6) {
            Image(systemName: "music.note.list")
                .font(.caption.weight(.bold))
            Text(model.state?.queueStatusText ?? "Queue loading")
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(PardoraTheme.accent)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(PardoraTheme.accent.opacity(0.12), in: Capsule())
        .accessibilityLabel("Queue status")
        .accessibilityValue(model.state?.queueStatusText ?? "Queue loading")
    }

    private func nextUpTitle(title: String) -> some View {
        HStack(alignment: .center, spacing: 6) {
            Text("Next up")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)

            AutoScrollingText(
                title,
                font: .callout.weight(.semibold),
                foregroundStyle: .primary,
                height: 20,
                gap: 28
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Next up \(title)")
    }

    private var styleMenu: some View {
        Menu {
            ForEach(selectableStyles) { style in
                Button {
                    Task { await model.selectMusicStyle(style) }
                } label: {
                    if model.state?.selectedStyleId == style {
                        Label(style.displayName, systemImage: "checkmark")
                    } else {
                        Text(style.displayName)
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(model.state?.selectedStyleId.displayName ?? "Radio stream")
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .minimumScaleFactor(0.72)

                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.bold))
            }
            .foregroundStyle(PardoraTheme.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(PardoraTheme.accent.opacity(0.12), in: Capsule())
        }
        .disabled(model.state == nil)
        .accessibilityLabel("Music Style")
        .accessibilityValue(model.state?.selectedStyleId.displayName ?? "Unavailable")
    }

    private var visiblePlaybackStatus: String? {
        guard let status = player.statusMessage,
              status != "Playing",
              status != "Paused"
        else {
            return nil
        }

        return status
    }

    private var playbackIdentity: String {
        [
            model.streamURL?.absoluteString,
            model.state?.currentTrack?.id,
            model.state?.currentTrack?.title,
            model.state?.selectedStyleId.rawValue,
        ]
        .compactMap(\.self)
        .joined(separator: "|")
    }

    private var progressIdentity: String {
        [
            playbackIdentity,
            String(player.isPlaying),
        ].joined(separator: "|")
    }

    private func updateProgressLoop() async {
        while !Task.isCancelled {
            player.refreshProgress()
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private var playbackControls: some View {
        GeometryReader { geometry in
            playbackControls(width: geometry.size.width)
        }
        .frame(height: 86)
        .background(.bar)
    }

    private func playbackControls(width: CGFloat) -> some View {
        let compact = width < 360
        let horizontalPadding: CGFloat = compact ? 8 : 16
        let spacing: CGFloat = compact ? 8 : 12
        let availableWidth = max(0, width - (horizontalPadding * 2) - (spacing * 3))
        let playWidth = min(76, max(66, availableWidth * 0.28))
        let actionWidth = max(48, (availableWidth - playWidth) / 3)
        let playHeight: CGFloat = compact ? 58 : 62
        let actionHeight: CGFloat = compact ? 54 : 58
        let liked = currentTrackLiked
        let disliked = currentTrackDisliked

        return HStack(spacing: spacing) {
            Button {
                player.togglePlayback()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.black)
                    .frame(width: playWidth, height: playHeight)
                    .background(PardoraTheme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")

            Button {
                Task { await model.likeCurrentTrack() }
            } label: {
                Image(systemName: "hand.thumbsup.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(liked ? .black : PardoraTheme.accent)
                    .frame(width: actionWidth, height: actionHeight)
                    .background(liked ? PardoraTheme.accent : PardoraTheme.accent.opacity(0.18), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(liked ? "Liked" : "Like")

            Button {
                Task { await model.skipCurrentTrack() }
            } label: {
                Image(systemName: "forward.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(PardoraTheme.accent)
                    .frame(width: actionWidth, height: actionHeight)
                    .background(PardoraTheme.accent.opacity(0.18), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Skip")

            Button(role: .destructive) {
                Task { await model.dislikeCurrentTrack() }
            } label: {
                Image(systemName: "hand.thumbsdown.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(disliked ? .black : PardoraTheme.accent)
                    .frame(width: actionWidth, height: actionHeight)
                    .background(disliked ? PardoraTheme.destructive : PardoraTheme.accent.opacity(0.18), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(disliked ? "Disliked" : "Dislike")
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, 10)
    }

    private var currentTrackLiked: Bool {
        model.state?.isTrackLiked(model.state?.currentTrack) == true
    }

    private var currentTrackDisliked: Bool {
        model.state?.isTrackDisliked(model.state?.currentTrack) == true
    }

    private var selectableStyles: [RadioStyleID] {
        guard let selectedStyle = model.state?.selectedStyleId,
              !RadioStyleID.allCases.contains(selectedStyle)
        else {
            return RadioStyleID.allCases
        }

        return [selectedStyle] + RadioStyleID.allCases
    }
}

private struct AutoScrollingText: View {
    var text: String
    var font: Font
    var foregroundStyle: Color
    var height: CGFloat
    var gap: CGFloat

    @State private var textWidth: CGFloat = 0
    @State private var containerWidth: CGFloat = 0
    @State private var isScrolling = false

    init(
        _ text: String,
        font: Font,
        foregroundStyle: Color,
        height: CGFloat,
        gap: CGFloat = 36
    ) {
        self.text = text
        self.font = font
        self.foregroundStyle = foregroundStyle
        self.height = height
        self.gap = gap
    }

    var body: some View {
        GeometryReader { geometry in
            let shouldScroll = textWidth > geometry.size.width + 1
            let scrollDistance = textWidth + gap

            HStack(spacing: gap) {
                scrollingLabel

                if shouldScroll {
                    scrollingLabel
                }
            }
            .offset(x: shouldScroll && isScrolling ? -scrollDistance : 0)
            .animation(
                shouldScroll
                    ? .linear(duration: max(6, scrollDistance / 22)).repeatForever(autoreverses: false)
                    : nil,
                value: isScrolling
            )
            .frame(width: geometry.size.width, alignment: .leading)
            .clipped()
            .onAppear {
                containerWidth = geometry.size.width
                restartScrollingIfNeeded(shouldScroll: shouldScroll)
            }
            .onChange(of: geometry.size.width) { _, width in
                containerWidth = width
                restartScrollingIfNeeded(shouldScroll: textWidth > width + 1)
            }
            .onChange(of: text) { _, _ in
                isScrolling = false
                restartScrollingIfNeeded(shouldScroll: shouldScroll)
            }
        }
        .frame(height: height)
        .background(
            scrollingLabel
                .hidden()
                .fixedSize(horizontal: true, vertical: false)
                .background(
                    GeometryReader { geometry in
                        Color.clear.preference(key: TextWidthPreferenceKey.self, value: geometry.size.width)
                    }
                )
        )
        .onPreferenceChange(TextWidthPreferenceKey.self) { width in
            textWidth = width
            restartScrollingIfNeeded(shouldScroll: width > containerWidth + 1)
        }
    }

    private var scrollingLabel: some View {
        Text(text)
            .font(font)
            .foregroundStyle(foregroundStyle)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }

    private func restartScrollingIfNeeded(shouldScroll: Bool) {
        isScrolling = false
        guard shouldScroll else {
            return
        }

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(650))
            isScrolling = true
        }
    }
}

private struct TextWidthPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct TrackProgressView: View {
    var progress: RadioPlaybackProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ProgressView(value: progress.fraction)
                .tint(PardoraTheme.accent)
                .accessibilityLabel("Song Progress")
                .accessibilityValue("\(formatTime(progress.elapsedSeconds)) of \(formatTime(progress.durationSeconds ?? 0))")

            HStack {
                Text(formatTime(progress.elapsedSeconds))
                Spacer(minLength: 12)
                Text(formatTime(progress.durationSeconds ?? 0))
            }
            .font(.caption.monospacedDigit().weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(.top, 2)
    }

    private func formatTime(_ totalSeconds: Int) -> String {
        let safeSeconds = max(0, totalSeconds)
        let minutes = safeSeconds / 60
        let seconds = safeSeconds % 60
        return "\(minutes):\(String(format: "%02d", seconds))"
    }
}

private struct StatusBanner: View {
    enum Tone {
        case neutral
        case warning
    }

    var text: String
    var tone: Tone

    var body: some View {
        Text(text)
            .font(.callout.weight(.semibold))
            .foregroundStyle(foregroundStyle)
            .lineLimit(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 8))
    }

    private var foregroundStyle: Color {
        switch tone {
        case .neutral:
            .secondary
        case .warning:
            PardoraTheme.warning
        }
    }

    private var backgroundStyle: Color {
        switch tone {
        case .neutral:
            Color.secondary.opacity(0.12)
        case .warning:
            PardoraTheme.warning.opacity(0.14)
        }
    }
}

#Preview {
    NavigationStack {
        NowPlayingView(model: RadioAppModel())
    }
}
