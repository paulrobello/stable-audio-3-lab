import SwiftUI

struct QueueView: View {
    var model: RadioAppModel

    var body: some View {
        List {
            ForEach(model.state?.selectedQueue ?? []) { track in
                VStack(alignment: .leading, spacing: 4) {
                    Text(track.title)
                        .font(.headline)
                    Text(track.filename)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if track.isLiked {
                        Label("Liked", systemImage: "hand.thumbsup.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PardoraTheme.warning)
                    }
                }
            }
        }
        .overlay {
            if model.state?.selectedQueue.isEmpty ?? true {
                ContentUnavailableView("No queued songs", systemImage: "music.note.list")
            }
        }
        .navigationTitle("Queue")
        .refreshable {
            await model.refresh()
        }
    }
}

#Preview {
    NavigationStack {
        QueueView(model: RadioAppModel())
    }
}
