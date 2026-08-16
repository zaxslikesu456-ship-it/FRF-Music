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

    private var silentPlayer: AVAudioPlayer?
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
                options: [.allowAirPlay, .allowBluetooth, .allowBluetoothA2DP]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("BackgroundAudioPlugin AudioSession setup error: \(error)")
        }
    }

    private func setupSilentPlayer() {
        if silentPlayer != nil { return }
        
        guard let silentData = createSilentWavData() else { return }
        do {
            silentPlayer = try AVAudioPlayer(data: silentData)
            silentPlayer?.numberOfLoops = -1
            silentPlayer?.volume = 0.001
            silentPlayer?.prepareToPlay()
        } catch {
            print("BackgroundAudioPlugin silent player error: \(error)")
        }
    }

    private func createSilentWavData() -> Data? {
        let sampleRate: Int32 = 44100
        let numChannels: Int16 = 2
        let bitsPerSample: Int16 = 16
        let durationSeconds: Int32 = 1
        let numSamples = sampleRate * durationSeconds
        let subChunk2Size = numSamples * Int32(numChannels * (bitsPerSample / 8))
        let chunkSize = 36 + subChunk2Size

        var data = Data()
        data.append(contentsOf: "RIFF".utf8)
        var cs = chunkSize
        data.append(Data(bytes: &cs, count: 4))
        data.append(contentsOf: "WAVE".utf8)
        data.append(contentsOf: "fmt ".utf8)
        var sc1s: Int32 = 16
        data.append(Data(bytes: &sc1s, count: 4))
        var audioFormat: Int16 = 1
        data.append(Data(bytes: &audioFormat, count: 2))
        var nc = numChannels
        data.append(Data(bytes: &nc, count: 2))
        var sr = sampleRate
        data.append(Data(bytes: &sr, count: 4))
        var byteRate = sampleRate * Int32(numChannels * (bitsPerSample / 8))
        data.append(Data(bytes: &byteRate, count: 4))
        var blockAlign: Int16 = numChannels * (bitsPerSample / 8)
        data.append(Data(bytes: &blockAlign, count: 2))
        var bps = bitsPerSample
        data.append(Data(bytes: &bps, count: 2))
        data.append(contentsOf: "data".utf8)
        var sc2s = subChunk2Size
        data.append(Data(bytes: &sc2s, count: 4))
        data.append(Data(repeating: 0, count: Int(subChunk2Size)))
        return data
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
        setupSilentPlayer()
        silentPlayer?.play()

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

        if isPlaying {
            setupAudioSession()
            setupSilentPlayer()
            if silentPlayer?.isPlaying == false {
                silentPlayer?.play()
            }
        } else {
            silentPlayer?.pause()
        }

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
        silentPlayer?.stop()
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
