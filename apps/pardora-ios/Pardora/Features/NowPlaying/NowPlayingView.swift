import SwiftUI

struct NowPlayingView: View {
    var model: RadioAppModel

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
                }
            }
            .padding()
        }
        .navigationTitle("Now")
        .refreshable {
            await model.refresh()
        }
    }
}

#Preview {
    NavigationStack {
        NowPlayingView(model: RadioAppModel())
    }
}
