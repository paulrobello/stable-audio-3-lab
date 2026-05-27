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
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        Task { await model.selectTrack(track) }
                    } label: {
                        Label("Play", systemImage: "play.fill")
                    }
                    .tint(PardoraTheme.accent)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        Task { await model.deleteTrack(track) }
                    } label: {
                        Label("Delete", systemImage: "trash")
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
