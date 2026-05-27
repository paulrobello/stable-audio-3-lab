import SwiftUI

struct SettingsView: View {
    @Bindable var model: RadioAppModel

    var body: some View {
        Form {
            Section("Server") {
                Picker("Connection", selection: $model.endpointMode) {
                    ForEach(RadioEndpointMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .onChange(of: model.endpointMode) {
                    model.applyEndpointMode()
                }

                if model.endpointMode == .custom {
                    TextField("Custom server", text: $model.serverOrigin)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .onSubmit {
                            model.applyEndpointMode()
                        }
                }

                LabeledContent("Using", value: model.serverOrigin)
                LabeledContent("Mode", value: model.endpointSummary)
                if let localServerOrigin = model.localServerOrigin {
                    LabeledContent("Local", value: localServerOrigin)
                }
                LabeledContent("Public", value: model.publicServerOrigin)

                Button("Test Connection") {
                    Task { await model.refresh() }
                }

                CloudflareOneButton()
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
