import SwiftUI

struct SettingsView: View {
    @Bindable var model: RadioAppModel

    var body: some View {
        Form {
            Section("Server") {
                TextField("Radio server", text: $model.serverOrigin)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                Button("Test Connection") {
                    Task { await model.refresh() }
                }
            }

            Section("Station") {
                LabeledContent("Style", value: model.state?.selectedStyleId.displayName ?? "Unknown")
                LabeledContent("Prompt Model", value: model.state?.promptModel ?? "Unknown")
                LabeledContent("Announcements", value: model.state?.announceEnabled == true ? "On" : "Off")
                LabeledContent("TTS", value: model.state?.ttsProvider.displayName ?? "Unknown")
                Button("Save Station Settings") {
                    Task { await model.saveConfiguration() }
                }
                .disabled(model.state == nil)
            }
        }
        .navigationTitle("Settings")
    }
}

#Preview {
    NavigationStack {
        SettingsView(model: RadioAppModel())
    }
}
