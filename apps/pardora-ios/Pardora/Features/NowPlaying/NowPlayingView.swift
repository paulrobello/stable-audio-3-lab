import SwiftUI

struct NowPlayingView: View {
    var model: RadioAppModel
    @State private var player = RadioPlayer()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Pardora")
                    .font(.largeTitle.bold())
                Text(model.state?.selectedStyleId.displayName ?? "Radio stream")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 10) {
                    Text(model.state?.currentTrack?.title ?? "No song loaded")
                        .font(.title2.bold())
                    Text(model.state?.currentTrack?.prompt ?? "Connect to the Stable Audio radio server.")
                        .foregroundStyle(.secondary)
                    Text(model.state.map { "\($0.queueAheadCount)/\($0.queueTarget) ahead" } ?? "Queue unavailable")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PardoraTheme.accent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))

                if let status = model.statusMessage {
                    Text(status)
                        .font(.callout)
                        .foregroundStyle(PardoraTheme.warning)

                    if status == RadioAppModel.cloudflareVPNMessage {
                        CloudflareOneButton()
                            .buttonStyle(.bordered)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Now")
        .refreshable {
            await model.refresh()
        }
        .safeAreaInset(edge: .bottom) {
            playbackControls
        }
        .task(id: model.streamURL?.absoluteString) {
            player.load(url: model.streamURL)
        }
    }

    private var playbackControls: some View {
        HStack(spacing: 14) {
            Button {
                player.togglePlayback()
            } label: {
                Label(player.isPlaying ? "Pause" : "Play", systemImage: player.isPlaying ? "pause.fill" : "play.fill")
                    .frame(width: 66, height: 58)
            }
            .font(.title2.weight(.semibold))
            .buttonStyle(.borderedProminent)

            Button {
                Task { await model.likeCurrentTrack() }
            } label: {
                Label("Like", systemImage: "hand.thumbsup.fill")
                    .frame(width: 58, height: 54)
            }
            .font(.title3.weight(.semibold))
            .buttonStyle(.bordered)

            Button {
                Task { await model.skipCurrentTrack() }
            } label: {
                Label("Skip", systemImage: "forward.fill")
                    .frame(width: 58, height: 54)
            }
            .font(.title3.weight(.semibold))
            .buttonStyle(.bordered)

            Button(role: .destructive) {
                Task { await model.dislikeCurrentTrack() }
            } label: {
                Label("Dislike", systemImage: "hand.thumbsdown.fill")
                    .frame(width: 58, height: 54)
            }
            .font(.title3.weight(.semibold))
            .buttonStyle(.bordered)
        }
        .labelStyle(.iconOnly)
        .frame(maxWidth: .infinity)
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

#Preview {
    NavigationStack {
        NowPlayingView(model: RadioAppModel())
    }
}
