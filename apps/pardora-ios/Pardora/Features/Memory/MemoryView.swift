import SwiftUI

struct MemoryView: View {
    var model: RadioAppModel

    private var feedback: RadioFeedbackSummary? {
        guard let state = model.state else {
            return nil
        }

        return state.feedbackSummary(for: state.selectedStyleId)
    }

    var body: some View {
        List {
            Section("Likes") {
                ForEach(feedback?.likes ?? [], id: \.self) { item in
                    Text(item)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            deleteFeedbackButton(phrase: item, rating: .up)
                        }
                }
            }

            Section("Dislikes") {
                ForEach(feedback?.dislikes ?? [], id: \.self) { item in
                    Text(item)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            deleteFeedbackButton(phrase: item, rating: .down)
                        }
                }
            }

            if let profile = feedback?.tasteProfile {
                Section("Taste Profile") {
                    ForEach(profile.promptDirectives, id: \.self) { item in
                        Text(item)
                    }
                }
            }
        }
        .overlay {
            if feedback?.isEmpty != false {
                ContentUnavailableView("No feedback yet", systemImage: "brain.head.profile")
            }
        }
        .navigationTitle("Memory")
    }

    private func deleteFeedbackButton(phrase: String, rating: RadioRating) -> some View {
        Button(role: .destructive) {
            guard let styleID = model.state?.selectedStyleId else {
                return
            }

            Task {
                await model.deleteMemoryFeedback(styleID: styleID, phrase: phrase, rating: rating)
            }
        } label: {
            Label("Delete", systemImage: "trash")
        }
        .tint(PardoraTheme.destructive)
    }
}

#Preview {
    NavigationStack {
        MemoryView(model: RadioAppModel())
    }
}
