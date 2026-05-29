import SwiftUI

struct SettingsView: View {
    @Bindable var model: RadioAppModel
    @AppStorage(PardoraSettings.autoPlayOnLaunchKey) private var autoPlayOnLaunch = false
    @AppStorage(PardoraSettings.carPlayModeEnabledKey) private var carPlayModeEnabled = true
    @State private var player = RadioPlayer.shared

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
                    Task { await model.refresh() }
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

                Button(model.isRefreshing ? "Testing..." : "Test Connection") {
                    Task { await model.testConnection() }
                }
                .disabled(model.isRefreshing)

                if let connectionTestMessage = model.connectionTestMessage {
                    Text(connectionTestMessage)
                        .font(.callout)
                        .foregroundStyle(model.statusMessage == nil ? .secondary : PardoraTheme.warning)
                }

                CloudflareOneButton()
            }

            Section("Station") {
                Picker("Prompt Model", selection: promptModelSelection) {
                    ForEach(promptModelOptions, id: \.self) { promptModel in
                        Text(promptModel).tag(promptModel)
                    }
                }
                .disabled(model.state == nil)

                Toggle("Announcements", isOn: announcementsSelection)
                    .disabled(model.state == nil)

                Picker("TTS Provider", selection: ttsProviderSelection) {
                    ForEach(RadioTTSProvider.allCases) { provider in
                        Text(provider.displayName).tag(provider)
                    }
                }
                .disabled(model.state == nil)

                Picker("TTS Voice", selection: ttsVoiceSelection) {
                    ForEach(model.ttsVoiceOptions) { voice in
                        Text(voice.label).tag(voice.id)
                    }
                }
                .disabled(model.state == nil)

                if let voiceDescription {
                    Text(voiceDescription)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button("Save Station Settings") {
                    Task { await model.saveConfiguration() }
                }
                .disabled(model.state == nil)
            }

            Section("Playback") {
                Toggle("Auto Play on App Launch", isOn: $autoPlayOnLaunch)
                Toggle("Dynamic Island", isOn: liveActivitySelection)
                Toggle("CarPlay Mode", isOn: $carPlayModeEnabled)

                Button(role: .destructive) {
                    player.stop()
                } label: {
                    Label("Stop App", systemImage: "stop.fill")
                }
            }
        }
        .navigationTitle("Settings")
        .task(id: ttsProviderTaskID) {
            await model.loadTTSVoiceOptions()
        }
    }

    private var promptModelSelection: Binding<String> {
        Binding(
            get: { model.state?.promptModel ?? RadioPromptModelOptions.defaults[0] },
            set: { promptModel in
                model.updatePromptModel(promptModel)
                Task { await model.saveConfiguration() }
            }
        )
    }

    private var promptModelOptions: [String] {
        RadioPromptModelOptions.merged(model.promptModels, currentModel: model.state?.promptModel)
    }

    private var announcementsSelection: Binding<Bool> {
        Binding(
            get: { model.state?.announceEnabled == true },
            set: { enabled in
                model.updateAnnouncementsEnabled(enabled)
                Task { await model.saveConfiguration() }
            }
        )
    }

    private var ttsProviderSelection: Binding<RadioTTSProvider> {
        Binding(
            get: { model.state?.ttsProvider ?? .openai },
            set: { provider in
                model.updateTTSProvider(provider)
                Task {
                    await model.saveConfiguration()
                    await model.loadTTSVoiceOptions()
                }
            }
        )
    }

    private var ttsProviderTaskID: String {
        model.state?.ttsProvider.rawValue ?? ""
    }

    private var ttsVoiceSelection: Binding<String> {
        Binding(
            get: { model.state?.ttsVoice ?? RadioTTSVoiceOption.defaultVoice(for: model.state?.ttsProvider ?? .openai) },
            set: { voice in
                model.updateTTSVoice(voice)
                Task { await model.saveConfiguration() }
            }
        )
    }

    private var voiceDescription: String? {
        guard let voice = model.ttsVoiceOptions.first(where: { $0.id == model.state?.ttsVoice }) else {
            return nil
        }

        return voice.description
    }

    private var liveActivitySelection: Binding<Bool> {
        Binding(
            get: { player.liveActivityEnabled },
            set: { enabled in
                player.setLiveActivityEnabled(enabled)
            }
        )
    }
}

#Preview {
    NavigationStack {
        SettingsView(model: RadioAppModel())
    }
}
