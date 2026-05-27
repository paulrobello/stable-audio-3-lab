import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PardoraLiveActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        PardoraLiveActivityWidget()
    }
}

struct PardoraLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PardoraActivityAttributes.self) { context in
            lockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.88))
                .activitySystemActionForegroundColor(.mint)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    playbackBadge(state: context.state)
                }

                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.stationName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.mint)
                        Text(context.state.styleName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.isPlaying ? "Playing" : "Paused")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.mint)
                        .lineLimit(1)
                }

                DynamicIslandExpandedRegion(.bottom) {
                    trackTitleLabel(context.state.trackTitle, font: .caption.weight(.semibold))
                }
            } compactLeading: {
                Image(systemName: context.state.isPlaying ? "waveform" : "waveform.slash")
                    .foregroundStyle(.mint)
            } compactTrailing: {
                trackTitleLabel(context.state.trackTitle, font: .caption2.weight(.semibold))
            } minimal: {
                Image(systemName: "waveform.circle.fill")
                    .foregroundStyle(.mint)
            }
        }
    }

    private func lockScreenView(context: ActivityViewContext<PardoraActivityAttributes>) -> some View {
        HStack(spacing: 12) {
            playbackBadge(state: context.state)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(context.attributes.stationName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.mint)
                    Text(context.state.isPlaying ? "Playing" : "Paused")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                }

                Text(context.state.trackTitle)
                    .font(.headline)
                    .lineLimit(1)

                Text(context.state.styleName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
    }

    private func playbackBadge(state: PardoraActivityAttributes.ContentState) -> some View {
        ZStack {
            Circle()
                .fill(Color.mint.opacity(0.18))
            Image(systemName: state.isPlaying ? "waveform" : "waveform.slash")
                .font(.caption.weight(.bold))
                .foregroundStyle(.mint)
        }
        .frame(width: 34, height: 34)
        .accessibilityLabel(state.isPlaying ? "Pardora playing" : "Pardora paused")
    }

    private func trackTitleLabel(_ text: String, font: Font) -> some View {
        Text(text)
            .font(font)
            .foregroundStyle(.primary)
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(0.65)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
