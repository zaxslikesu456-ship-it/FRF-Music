import Foundation
import Capacitor
import AVFoundation
import MediaPlayer

@objc(BackgroundAudioPlugin)
public class BackgroundAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundAudioPlugin"
    public let jsName = "BackgroundAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var isConfigured = false

    public override func load() {
        setupAudioSession()
        setupRemoteCommandCenter()
    }

    private func setupAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.mixWithOthers, .allowAirPlay, .allowBluetooth, .allowBluetoothA2DP]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("BackgroundAudioPlugin AudioSession setup error: \(error)")
        }
    }

    private func setupRemoteCommandCenter() {
        if isConfigured { return }
        isConfigured = true

        let rcc = MPRemoteCommandCenter.shared()

        rcc.playCommand.isEnabled = true
        rcc.playCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remotePlay", data: [:])
            return .success
        }

        rcc.pauseCommand.isEnabled = true
        rcc.pauseCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remotePause", data: [:])
            return .success
        }

        rcc.togglePlayPauseCommand.isEnabled = true
        rcc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remoteTogglePlay", data: [:])
            return .success
        }

        rcc.nextTrackCommand.isEnabled = true
        rcc.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remoteNext", data: [:])
            return .success
        }

        rcc.previousTrackCommand.isEnabled = true
        rcc.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remotePrev", data: [:])
            return .success
        }

        rcc.changePlaybackPositionCommand.isEnabled = true
        rcc.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let posEvent = event as? MPChangePlaybackPositionCommandEvent {
                self?.notifyListeners("remoteSeek", data: ["position": posEvent.positionTime])
                return .success
            }
            return .commandFailed
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        setupAudioSession()

        let title = call.getString("title", "")
        let artist = call.getString("artist", "")
        let isPlaying = call.getBool("isPlaying", true)
        let coverUrl = call.getString("coverUrl", "")
        let duration = call.getDouble("duration", 0.0)
        let position = call.getDouble("position", 0.0)

        updateNowPlaying(
            title: title,
            artist: artist,
            isPlaying: isPlaying,
            coverUrl: coverUrl.isEmpty ? nil : coverUrl,
            duration: duration > 0 ? duration : nil,
            position: position >= 0 ? position : nil
        )
        call.resolve()
    }

    @objc public func update(_ call: CAPPluginCall) {
        let title = call.getString("title", "")
        let artist = call.getString("artist", "")
        let isPlaying = call.getBool("isPlaying", true)
        let coverUrl = call.getString("coverUrl", "")
        let duration = call.getDouble("duration", 0.0)
        let position = call.getDouble("position", 0.0)

        updateNowPlaying(
            title: title,
            artist: artist,
            isPlaying: isPlaying,
            coverUrl: coverUrl.isEmpty ? nil : coverUrl,
            duration: duration > 0 ? duration : nil,
            position: position >= 0 ? position : nil
        )
        call.resolve()
    }

    @objc public func stop(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    private func updateNowPlaying(
        title: String,
        artist: String,
        isPlaying: Bool,
        coverUrl: String?,
        duration: Double?,
        position: Double?
    ) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]

        if let d = duration, d > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = d
        }
        if let p = position, p >= 0 {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = p
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        if let cover = coverUrl, let url = URL(string: cover) {
            DispatchQueue.global(qos: .userInitiated).async {
                if let data = try? Data(contentsOf: url), let image = UIImage(data: data) {
                    DispatchQueue.main.async {
                        var updated = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                        let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                        updated[MPMediaItemPropertyArtwork] = artwork
                        MPNowPlayingInfoCenter.default().nowPlayingInfo = updated
                    }
                }
            }
        }
    }
}
