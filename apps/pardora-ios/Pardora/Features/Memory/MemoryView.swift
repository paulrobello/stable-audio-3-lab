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
                ForEach(feedback?.likeItems ?? []) { item in
                    MemoryFeedbackItemRow(item: item)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            deleteFeedbackButton(phrase: item.phrase, rating: .up)
                        }
                }
            }

            Section("Dislikes") {
                ForEach(feedback?.dislikeItems ?? []) { item in
                    MemoryFeedbackItemRow(item: item)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            deleteFeedbackButton(phrase: item.phrase, rating: .down)
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

private struct MemoryFeedbackItemRow: View {
    var item: RadioMemoryItem
    @State private var isPromptExpanded = false
    @State private var isAssessmentExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DisclosureGroup(isExpanded: $isPromptExpanded) {
                Text(item.phrase)
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .padding(.top, 6)
            } label: {
                disclosureLabel(systemImage: "text.quote", title: "Prompt", subtitle: item.phrase)
            }

            if let assessment = item.assessment {
                DisclosureGroup(isExpanded: $isAssessmentExpanded) {
                    MemoryAssessmentDetail(assessment: assessment)
                        .padding(.top, 6)
                } label: {
                    disclosureLabel(systemImage: "waveform.and.magnifyingglass", title: "Assessment", subtitle: assessment.summary ?? assessment.model ?? "Saved assessment")
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func disclosureLabel(systemImage: String, title: String, subtitle: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

private struct MemoryAssessmentDetail: View {
    var assessment: RadioAudioAssessment

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let summary = assessment.summary {
                Text(summary)
                    .font(.callout)
                    .textSelection(.enabled)
            }

            if let modelText {
                Label(modelText, systemImage: "cpu")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            assessmentValues(title: "Positives", values: assessment.attributes.positives)
            assessmentValues(title: "Negatives", values: assessment.attributes.negatives)
            assessmentValues(title: "Instruments", values: assessment.attributes.instruments)
            assessmentValues(title: "Mood", values: assessment.attributes.mood)
            assessmentValues(title: "Production", values: assessment.attributes.production)
        }
    }

    private var modelText: String? {
        switch (assessment.provider, assessment.model) {
        case let (provider?, model?):
            "\(provider) · \(model)"
        case let (provider?, nil):
            provider
        case let (nil, model?):
            model
        default:
            nil
        }
    }

    @ViewBuilder
    private func assessmentValues(title: String, values: [String]) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(values, id: \.self) { value in
                    Text("• \(value)")
                        .font(.caption)
                        .foregroundStyle(.primary)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        MemoryView(model: RadioAppModel())
    }
}
