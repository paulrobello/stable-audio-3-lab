import SwiftUI

struct MemoryView: View {
    var model: RadioAppModel

    private var preference: RadioPreference? {
        guard let state = model.state else {
            return nil
        }

        return state.preference(for: state.selectedStyleId)
    }

    var body: some View {
        List {
            Section("Likes") {
                ForEach(preference?.likes ?? [], id: \.self) { item in
                    Text(item)
                }
            }

            Section("Dislikes") {
                ForEach(preference?.dislikes ?? [], id: \.self) { item in
                    Text(item)
                }
            }

            if let profile = preference?.tasteProfile {
                Section("Taste Profile") {
                    ForEach(profile.promptDirectives, id: \.self) { item in
                        Text(item)
                    }
                }
            }
        }
        .overlay {
            if preference == nil {
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
