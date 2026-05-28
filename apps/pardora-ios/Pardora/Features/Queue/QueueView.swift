import SwiftUI

struct QueueView: View {
    var model: RadioAppModel
    @State private var isSelectionMode = false
    @State private var selectedFilenames = Set<String>()
    @State private var isDeleting = false
    @State private var confirmsDeletion = false

    var body: some View {
        List {
            ForEach(queue) { track in
                queueRow(track)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if isSelectionMode {
                            toggleSelection(track)
                        }
                    }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    if !isSelectionMode {
                        Button {
                            Task { await model.selectTrack(track) }
                        } label: {
                            Label("Play", systemImage: "play.fill")
                        }
                        .tint(PardoraTheme.accent)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    if !isSelectionMode {
                        Button(role: .destructive) {
                            Task { await model.deleteTrack(track) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .tint(PardoraTheme.destructive)
                    }
                }
            }
        }
        .overlay {
            if queue.isEmpty {
                ContentUnavailableView("No queued songs", systemImage: "music.note.list")
            }
        }
        .safeAreaInset(edge: .bottom) {
            if isSelectionMode {
                selectionToolbar
            }
        }
        .navigationTitle("Queue")
        .toolbar {
            if !queue.isEmpty {
                ToolbarItem(placement: .topBarLeading) {
                    if isSelectionMode {
                        Button(selectedFilenames.count == queue.count ? "Clear" : "All") {
                            if selectedFilenames.count == queue.count {
                                selectedFilenames.removeAll()
                            } else {
                                selectedFilenames = Set(queue.map(\.filename))
                            }
                        }
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button(isSelectionMode ? "Done" : "Select") {
                        isSelectionMode.toggle()
                        if !isSelectionMode {
                            selectedFilenames.removeAll()
                        }
                    }
                }
            }
        }
        .confirmationDialog(
            "Delete \(selectedFilenames.count) selected songs?",
            isPresented: $confirmsDeletion,
            titleVisibility: .visible
        ) {
            Button("Delete Songs", role: .destructive) {
                Task { await deleteSelectedTracks() }
            }

            Button("Cancel", role: .cancel) {}
        }
        .onChange(of: queueFilenames) { _, filenames in
            selectedFilenames.formIntersection(Set(filenames))
            if filenames.isEmpty {
                isSelectionMode = false
            }
        }
        .refreshable {
            await model.refresh()
        }
    }

    private var queue: [RadioTrackRecord] {
        model.state?.selectedQueue ?? []
    }

    private var queueFilenames: [String] {
        queue.map(\.filename)
    }

    private var selectedTracks: [RadioTrackRecord] {
        queue.filter { selectedFilenames.contains($0.filename) }
    }

    private func queueRow(_ track: RadioTrackRecord) -> some View {
        let isSelected = selectedFilenames.contains(track.filename)
        let isCurrentTrack = track.filename == model.state?.currentTrack?.filename
        let thumbStatus = model.state?.thumbStatus(for: track)

        return HStack(alignment: .center, spacing: 12) {
            if isSelectionMode {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(isSelected ? PardoraTheme.accent : .secondary)
                    .frame(width: 28, height: 44)
                    .accessibilityHidden(true)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(track.title)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.84)

                    if let thumbStatus {
                        Image(systemName: thumbStatus.symbolName)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(thumbStatus.isNegative ? PardoraTheme.destructive : PardoraTheme.warning)
                            .accessibilityLabel(thumbStatus.accessibilityLabel)
                    }

                    if isCurrentTrack {
                        Image(systemName: "waveform")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(PardoraTheme.accent)
                            .accessibilityLabel("Playing")
                    }
                }

                Text(track.filename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Text(track.queueCreatedDetailText)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            if !isSelectionMode {
                Button {
                    Task { await model.rateTrack(track, rating: .up) }
                } label: {
                    Image(systemName: thumbStatus == .up ? "hand.thumbsup.fill" : "hand.thumbsup")
                        .font(.body.weight(.semibold))
                        .frame(width: 32, height: 36)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(thumbStatus == .up ? PardoraTheme.warning : .secondary)
                .accessibilityLabel("Thumbs up \(track.title)")

                Button {
                    Task { await model.rateTrack(track, rating: .down) }
                } label: {
                    Image(systemName: thumbStatus == .down ? "hand.thumbsdown.fill" : "hand.thumbsdown")
                        .font(.body.weight(.semibold))
                        .frame(width: 32, height: 36)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(thumbStatus == .down ? PardoraTheme.destructive : .secondary)
                .accessibilityLabel("Thumbs down \(track.title)")

                Button {
                    Task { await model.selectTrack(track) }
                } label: {
                    Image(systemName: isCurrentTrack ? "checkmark.circle.fill" : "play.fill")
                        .font(.body.weight(.semibold))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(isCurrentTrack ? PardoraTheme.accent : .primary)
                .disabled(isCurrentTrack)
                .accessibilityLabel(isCurrentTrack ? "Now playing" : "Play \(track.title)")
            }
        }
        .padding(.vertical, 6)
    }

    private var selectionToolbar: some View {
        HStack(spacing: 12) {
            Text("\(selectedFilenames.count) selected")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            Spacer()

            Button(role: .destructive) {
                confirmsDeletion = true
            } label: {
                Label(isDeleting ? "Deleting" : "Delete", systemImage: "trash")
                    .font(.subheadline.weight(.bold))
            }
            .buttonStyle(.borderedProminent)
            .disabled(selectedFilenames.isEmpty || isDeleting)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func toggleSelection(_ track: RadioTrackRecord) {
        if selectedFilenames.contains(track.filename) {
            selectedFilenames.remove(track.filename)
        } else {
            selectedFilenames.insert(track.filename)
        }
    }

    private func deleteSelectedTracks() async {
        let tracks = selectedTracks
        guard !tracks.isEmpty else {
            return
        }

        isDeleting = true
        await model.deleteTracks(tracks)
        selectedFilenames.subtract(Set(tracks.map(\.filename)))
        isSelectionMode = false
        isDeleting = false
    }
}

#Preview {
    NavigationStack {
        QueueView(model: RadioAppModel())
    }
}
