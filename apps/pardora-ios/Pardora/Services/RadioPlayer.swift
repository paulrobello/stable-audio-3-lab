import AVFoundation
import Foundation
import Observation

@MainActor
@Observable
final class RadioPlayer {
    private let player = AVPlayer()
    private(set) var isPlaying = false
    private(set) var currentURL: URL?

    func load(url: URL?) {
        guard currentURL != url else {
            return
        }

        currentURL = url
        if let url {
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
        } else {
            player.replaceCurrentItem(with: nil)
            isPlaying = false
        }
    }

    func togglePlayback() {
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }
}
