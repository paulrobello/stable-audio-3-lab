import XCTest
@testable import Pardora

final class PardoraSettingsTests: XCTestCase {
    func testCarPlayModeDefaultsToEnabledUntilUserChangesIt() {
        let suiteName = "PardoraSettingsTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertTrue(PardoraSettings.isCarPlayModeEnabled(defaults: defaults))

        defaults.set(false, forKey: PardoraSettings.carPlayModeEnabledKey)

        XCTAssertFalse(PardoraSettings.isCarPlayModeEnabled(defaults: defaults))
    }
}
