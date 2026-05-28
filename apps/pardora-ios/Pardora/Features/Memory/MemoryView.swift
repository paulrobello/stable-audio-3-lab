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
                }
            }

            Section("Dislikes") {
                ForEach(feedback?.dislikes ?? [], id: \.self) { item in
                    Text(item)
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
}

#Preview {
    NavigationStack {
        MemoryView(model: RadioAppModel())
    }
}
