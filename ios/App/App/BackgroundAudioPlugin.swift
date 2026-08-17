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
        CAPPluginMethod(name: "playUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var avPlayer: AVPlayer?
    private var timeObserverToken: Any?
    private var itemStatusObserver: NSKeyValueObservation?
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
                options: []
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback)
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                print("BackgroundAudioPlugin AudioSession setup error: \(error)")
            }
        }
    }

    private func setupRemoteCommandCenter() {
        if isConfigured { return }
        isConfigured = true

        let rcc = MPRemoteCommandCenter.shared()

        rcc.playCommand.isEnabled = true
        rcc.playCommand.addTarget { [weak self] _ in
            if let player = self?.avPlayer, player.currentItem != nil {
                player.play()
            }
            self?.notifyListeners("remotePlay", data: [:])
            return .success
        }

        rcc.pauseCommand.isEnabled = true
        rcc.pauseCommand.addTarget { [weak self] _ in
            if let player = self?.avPlayer, player.currentItem != nil {
                player.pause()
            }
            self?.notifyListeners("remotePause", data: [:])
            return .success
        }

        rcc.togglePlayPauseCommand.isEnabled = true
        rcc.togglePlayPauseCommand.addTarget { [weak self] _ in
            if let player = self?.avPlayer, player.currentItem != nil {
                if player.rate > 0 {
                    player.pause()
                } else {
                    player.play()
                }
            }
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
                if let player = self?.avPlayer, player.currentItem != nil {
                    let targetTime = CMTime(seconds: posEvent.positionTime, preferredTimescale: 600)
                    player.seek(to: targetTime)
                }
                self?.notifyListeners("remoteSeek", data: ["position": posEvent.positionTime])
                return .success
            }
            return .commandFailed
        }
    }

    @objc public func playUrl(_ call: CAPPluginCall) {
        setupAudioSession()

        let urlString = call.getString("url", "")
        let filePath = call.getString("filePath", "")
        let title = call.getString("title", "")
        let artist = call.getString("artist", "")
        let coverUrl = call.getString("coverUrl", "")
        let startTime = call.getDouble("startTime", 0.0)
        let duration = call.getDouble("duration", 0.0)

        var targetUrl: URL?

        if !filePath.isEmpty {
            let cleanPath = filePath.replacingOccurrences(of: "file://", with: "")
            targetUrl = URL(fileURLWithPath: cleanPath)
        } else if !urlString.isEmpty {
            targetUrl = URL(string: urlString)
        }

        guard let validUrl = targetUrl else {
            call.resolve([
                "error": "Invalid audio URL or file path"
            ])
            return
        }

        // Clean up any existing observer
        if let token = timeObserverToken, let player = avPlayer {
            player.removeTimeObserver(token)
            timeObserverToken = nil
        }

        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: nil)
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        itemStatusObserver?.invalidate()
        itemStatusObserver = nil

        let playerItem = AVPlayerItem(url: validUrl)
        if avPlayer == nil {
            avPlayer = AVPlayer(playerItem: playerItem)
        } else {
            avPlayer?.replaceCurrentItem(with: playerItem)
        }

        // Report stream failures (403, unsupported codec, network errors) to JS
        // so the web layer can re-resolve another stream instead of playing silence.
        itemStatusObserver = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            if item.status == .failed {
                self?.notifyListeners("playbackError", data: [
                    "message": item.error?.localizedDescription ?? "AVPlayer item failed"
                ])
            }
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerDidFinishPlaying),
            name: .AVPlayerItemDidPlayToEndTime,
            object: playerItem
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerFailedToPlayToEnd(_:)),
            name: .AVPlayerItemFailedToPlayToEndTime,
            object: playerItem
        )

        // Periodic time observer for progress updates
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserverToken = avPlayer?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            let currentSeconds = CMTimeGetSeconds(time)
            let itemDuration = self?.avPlayer?.currentItem?.duration
            let durSeconds = itemDuration != nil ? CMTimeGetSeconds(itemDuration!) : 0
            self?.notifyListeners("playbackProgress", data: [
                "currentTime": currentSeconds.isNaN ? 0 : currentSeconds,
                "duration": durSeconds.isNaN ? 0 : durSeconds
            ])
        }

        if startTime > 0 {
            let cmStartTime = CMTime(seconds: startTime, preferredTimescale: 600)
            avPlayer?.seek(to: cmStartTime)
        }

        avPlayer?.play()

        updateNowPlaying(
            title: title,
            artist: artist,
            isPlaying: true,
            coverUrl: coverUrl.isEmpty ? nil : coverUrl,
            duration: duration > 0 ? duration : nil,
            position: startTime >= 0 ? startTime : nil
        )

        call.resolve()
    }

    @objc public func pause(_ call: CAPPluginCall) {
        avPlayer?.pause()
        call.resolve()
    }

    @objc public func resume(_ call: CAPPluginCall) {
        avPlayer?.play()
        call.resolve()
    }

    @objc public func seek(_ call: CAPPluginCall) {
        let position = call.getDouble("position", 0.0)
        let cmTime = CMTime(seconds: position, preferredTimescale: 600)
        avPlayer?.seek(to: cmTime)
        call.resolve()
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
        if let token = timeObserverToken, let player = avPlayer {
            player.removeTimeObserver(token)
            timeObserverToken = nil
        }
        itemStatusObserver?.invalidate()
        itemStatusObserver = nil
        avPlayer?.pause()
        avPlayer?.replaceCurrentItem(with: nil)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    @objc private func playerDidFinishPlaying() {
        notifyListeners("playbackEnded", data: [:])
    }

    @objc private func playerFailedToPlayToEnd(_ note: Notification) {
        let message = (note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError)?.localizedDescription
            ?? "Playback failed before the end of the stream"
        notifyListeners("playbackError", data: ["message": message])
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
