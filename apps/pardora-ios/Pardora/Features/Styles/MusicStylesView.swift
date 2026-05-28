import SwiftUI

struct MusicStylesView: View {
    var model: RadioAppModel
    @State private var styleRequest = ""
    @State private var styleLabel = ""
    @State private var styleSeedPrompt = ""
    @State private var styleNegativePrompt = ""
    @State private var editingStyleID: RadioStyleID?
    @State private var busy: MusicStyleBusy?
    @State private var styleStatus: String?

    var body: some View {
        Form {
            if let status = model.statusMessage ?? styleStatus {
                Section {
                    Text(status)
                        .font(.callout)
                        .foregroundStyle(model.statusMessage == nil ? .secondary : PardoraTheme.warning)
                }
            }

            Section("Music Styles") {
                ForEach(model.availableMusicStyles) { style in
                    styleRow(style)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            if busy == nil {
                                Button(role: .destructive) {
                                    Task { await deleteStyle(style) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                .tint(PardoraTheme.destructive)
                            }
                        }
                }
            }

            Section(editingStyleID == nil ? "New Music Style" : "Edit Music Style") {
                TextField("Describe style", text: $styleRequest, axis: .vertical)
                    .lineLimit(2...4)
                    .textInputAutocapitalization(.sentences)

                Button {
                    Task { await draftStyle() }
                } label: {
                    Label(busy == .draft ? "Generating style prompts..." : "Generate style prompts", systemImage: "sparkles")
                }
                .disabled(busy != nil || styleRequest.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)

                TextField("Style name", text: $styleLabel)
                    .textInputAutocapitalization(.words)

                TextField("Style prompt", text: $styleSeedPrompt, axis: .vertical)
                    .lineLimit(3...8)
                    .textInputAutocapitalization(.sentences)

                TextField("Negative prompt", text: $styleNegativePrompt, axis: .vertical)
                    .lineLimit(2...5)
                    .textInputAutocapitalization(.sentences)

                Button {
                    Task { await saveStyle() }
                } label: {
                    Label(saveButtonTitle, systemImage: editingStyleID == nil ? "plus.circle.fill" : "checkmark.circle.fill")
                }
                .disabled(busy != nil || !canSaveStyle)

                if editingStyleID != nil {
                    Button("Cancel Edit", role: .cancel) {
                        clearStyleForm()
                    }
                }
            }
        }
        .navigationTitle("Styles")
    }

    private func styleRow(_ style: RadioStyle) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(style.label)
                    .font(.headline)

                if model.state?.selectedStyleId == style.id {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PardoraTheme.accent)
                        .accessibilityLabel("Selected")
                }
            }

            Text(style.seedPrompt)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            HStack(spacing: 8) {
                Button {
                    Task { await selectStyle(style) }
                } label: {
                    Label(model.state?.selectedStyleId == style.id ? "Selected" : "Select", systemImage: "music.note")
                }
                .disabled(busy != nil || model.state?.selectedStyleId == style.id)

                Button {
                    editStyle(style)
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .disabled(busy != nil)
            }
            .buttonStyle(.borderless)
            .font(.caption.weight(.semibold))
        }
        .padding(.vertical, 4)
    }

    private var saveButtonTitle: String {
        if busy == .save {
            editingStyleID == nil ? "Creating..." : "Saving..."
        } else {
            editingStyleID == nil ? "Create Music Style" : "Save Music Style"
        }
    }

    private var canSaveStyle: Bool {
        styleLabel.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && styleSeedPrompt.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8
    }

    private func selectStyle(_ style: RadioStyle) async {
        busy = .select
        await model.selectMusicStyle(style.id)
        if model.statusMessage == nil {
            styleStatus = "Selected \(style.label)."
        }
        busy = nil
    }

    private func draftStyle() async {
        busy = .draft
        styleStatus = "Generating style prompts..."
        if let draft = await model.draftMusicStyle(request: styleRequest) {
            styleLabel = draft.label
            styleSeedPrompt = draft.seedPrompt
            styleNegativePrompt = draft.negativePrompt
            editingStyleID = nil
            styleStatus = "Drafted \(draft.label)."
        }
        busy = nil
    }

    private func saveStyle() async {
        busy = .save
        let wasEditing = editingStyleID != nil
        if let style = await model.saveMusicStyle(
            styleID: editingStyleID,
            label: styleLabel,
            seedPrompt: styleSeedPrompt,
            negativePrompt: styleNegativePrompt
        ) {
            clearStyleForm()
            styleStatus = wasEditing ? "Saved \(style.label)." : "Created \(style.label)."
        }
        busy = nil
    }

    private func editStyle(_ style: RadioStyle) {
        editingStyleID = style.id
        styleLabel = style.label
        styleSeedPrompt = style.seedPrompt
        styleNegativePrompt = style.negativePrompt ?? ""
        styleStatus = "Editing \(style.label)."
    }

    private func deleteStyle(_ style: RadioStyle) async {
        busy = .delete
        if await model.deleteMusicStyle(style) {
            if editingStyleID == style.id {
                clearStyleForm()
            }
            styleStatus = "Deleted \(style.label)."
        }
        busy = nil
    }

    private func clearStyleForm() {
        editingStyleID = nil
        styleLabel = ""
        styleSeedPrompt = ""
        styleNegativePrompt = ""
    }
}

private enum MusicStyleBusy {
    case select
    case draft
    case save
    case delete
}

#Preview {
    NavigationStack {
        MusicStylesView(model: RadioAppModel())
    }
}
