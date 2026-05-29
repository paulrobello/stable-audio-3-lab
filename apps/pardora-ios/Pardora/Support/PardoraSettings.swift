import Foundation

enum PardoraSettings {
    static let autoPlayOnLaunchKey = "autoPlayOnLaunch"
    static let carPlayModeEnabledKey = "carPlayModeEnabled"
    static let liveActivityEnabledKey = "liveActivityEnabled"

    static func isCarPlayModeEnabled(defaults: UserDefaults = .standard) -> Bool {
        (defaults.object(forKey: carPlayModeEnabledKey) as? Bool) ?? true
    }
}
