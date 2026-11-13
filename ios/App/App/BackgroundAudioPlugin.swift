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
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setUpcoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearUpcoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNormGain", returnType: CAPPluginReturnPromise)
    ]

    // A queue player: the songs lined up behind the current one play on by
    // themselves, even while the app is in the background and the web layer (which
    // iOS suspends) cannot start the next song.
    private var avPlayer: AVQueuePlayer?
    private var timeObserverToken: Any?
    private var itemStatusObserver: NSKeyValueObservation?
    private var currentItemObserver: NSKeyValueObservation?
    private var isConfigured = false
    private var currentTrackId = ""

    // Details of the songs lined up behind the current one, keyed by player item.
    private struct UpcomingInfo {
        let trackId: String
        let title: String
        let artist: String
        let coverUrl: String
        let duration: Double
        let gainDb: Double
    }
    private var upcomingInfo: [ObjectIdentifier: UpcomingInfo] = [:]
    // The loaders streaming each YouTube song in the queue (see GoogleVideoLoader).
    // AVFoundation only holds them weakly.
    private var streamLoaders: [ObjectIdentifier: GoogleVideoLoader] = [:]

    /// A player item for a song: YouTube audio goes through GoogleVideoLoader,
    /// files and other addresses straight to AVPlayer.
    private func makeItem(for url: URL) -> AVPlayerItem {
        if GoogleVideoLoader.isGoogleVideo(url), let made = GoogleVideoLoader.makeAsset(for: url) {
            let item = AVPlayerItem(asset: made.asset)
            streamLoaders[ObjectIdentifier(item)] = made.loader
            return item
        }
        return AVPlayerItem(url: url)
    }

    /// Lets go of the loaders of songs no longer in the queue.
    private func pruneStreamLoaders() {
        let alive = Set((avPlayer?.items() ?? []).map { ObjectIdentifier($0) })
        streamLoaders = streamLoaders.filter { alive.contains($0.key) }
    }

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
            // With a song already queued, switch to it right here; the web layer may
            // be asleep and could not do it.
            if let player = self?.avPlayer, player.items().count > 1 {
                player.advanceToNextItem()
                player.play()
                return .success
            }
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
        let trackId = call.getString("trackId", "")
        let title = call.getString("title", "")
        let artist = call.getString("artist", "")
        let coverUrl = call.getString("coverUrl", "")
        let startTime = call.getDouble("startTime", 0.0)
        let duration = call.getDouble("duration", 0.0)
        let gainDb = call.getDouble("gainDb", 0.0)

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

        unwatchItem()
        upcomingInfo.removeAll()

        let playerItem = makeItem(for: validUrl)
        if let existing = avPlayer {
            existing.removeAllItems()
            existing.insert(playerItem, after: nil)
            pruneStreamLoaders()
        } else {
            let created = AVQueuePlayer(playerItem: playerItem)
            avPlayer = created
            observeCurrentItem(of: created)
        }
        currentTrackId = trackId
        applyGain(gainDb)

        // Report stream failures (403, unsupported codec, network errors) to JS
        // and tell it when the song ends.
        watch(item: playerItem)

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
        unwatchItem()
        upcomingInfo.removeAll()
        currentTrackId = ""
        avPlayer?.pause()
        // Not replaceCurrentItem(with: nil): on a queue player that skips ahead to the
        // next song instead of stopping.
        avPlayer?.removeAllItems()
        streamLoaders.removeAll()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }

    // Replaces everything lined up behind the current song with these songs.
    @objc public func setUpcoming(_ call: CAPPluginCall) {
        guard let player = avPlayer, player.currentItem != nil else {
            call.resolve(["queued": 0])
            return
        }
        clearUpcomingItems(of: player)

        // Read the raw options: plain strings and numbers, no Capacitor value casts.
        let entries = (call.options["items"] as? [[String: Any]]) ?? []
        var added = 0
        for entry in entries.prefix(12) {
            let urlString = entry["url"] as? String ?? ""
            let filePath = entry["filePath"] as? String ?? ""
            var target: URL?
            if !filePath.isEmpty {
                let cleanPath = filePath.replacingOccurrences(of: "file://", with: "")
                target = URL(fileURLWithPath: cleanPath)
            } else if !urlString.isEmpty {
                target = URL(string: urlString)
            }
            guard let url = target else { continue }

            let item = makeItem(for: url)
            guard player.canInsert(item, after: nil) else {
                streamLoaders.removeValue(forKey: ObjectIdentifier(item))
                continue
            }
            upcomingInfo[ObjectIdentifier(item)] = UpcomingInfo(
                trackId: entry["trackId"] as? String ?? "",
                title: entry["title"] as? String ?? "",
                artist: entry["artist"] as? String ?? "",
                coverUrl: entry["coverUrl"] as? String ?? "",
                duration: numberValue(entry["duration"]),
                gainDb: numberValue(entry["gainDb"])
            )
            player.insert(item, after: nil)
            added += 1
        }
        call.resolve(["queued": added])
    }

    @objc public func clearUpcoming(_ call: CAPPluginCall) {
        if let player = avPlayer {
            clearUpcomingItems(of: player)
        }
        call.resolve()
    }

    // Which song the player is on. The web layer asks when the app comes back to the
    // front, because songs may have rolled by while it was suspended.
    // Volume normalization: turn a loud song down by gainDb (0 or negative). The
    // phone's own volume still controls the overall level.
    private func applyGain(_ gainDb: Double) {
        guard let player = avPlayer else { return }
        player.volume = gainDb < 0 ? Float(pow(10.0, max(gainDb, -20.0) / 20.0)) : 1.0
    }

    @objc public func setNormGain(_ call: CAPPluginCall) {
        applyGain(call.getDouble("gainDb", 0.0))
        call.resolve()
    }

    @objc public func getCurrent(_ call: CAPPluginCall) {
        call.resolve(["trackId": currentTrackId])
    }

    private func clearUpcomingItems(of player: AVQueuePlayer) {
        for item in player.items().dropFirst() {
            player.remove(item)
            upcomingInfo.removeValue(forKey: ObjectIdentifier(item))
            streamLoaders.removeValue(forKey: ObjectIdentifier(item))
        }
    }

    private func numberValue(_ value: Any?) -> Double {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let n = value as? NSNumber { return n.doubleValue }
        return 0
    }

    // Per-song observers: when it ends, and when it fails to load or play.
    private func watch(item: AVPlayerItem) {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerDidFinishPlaying(_:)),
            name: .AVPlayerItemDidPlayToEndTime,
            object: item
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerFailedToPlayToEnd(_:)),
            name: .AVPlayerItemFailedToPlayToEndTime,
            object: item
        )
        itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] observed, _ in
            if observed.status == .failed {
                self?.notifyListeners("playbackError", data: [
                    "message": observed.error?.localizedDescription ?? "AVPlayer item failed"
                ])
            }
        }
    }

    private func unwatchItem() {
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: nil)
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        itemStatusObserver?.invalidate()
        itemStatusObserver = nil
    }

    private func observeCurrentItem(of player: AVQueuePlayer) {
        currentItemObserver?.invalidate()
        currentItemObserver = player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.handleCurrentItemChanged()
            }
        }
    }

    // The player rolled into a song that was lined up behind the previous one.
    private func handleCurrentItemChanged() {
        guard let player = avPlayer, let current = player.currentItem else { return }
        guard let info = upcomingInfo.removeValue(forKey: ObjectIdentifier(current)) else { return }

        // Details of songs that were skipped over are no longer needed.
        let alive = Set(player.items().map { ObjectIdentifier($0) })
        upcomingInfo = upcomingInfo.filter { alive.contains($0.key) }
        streamLoaders = streamLoaders.filter { alive.contains($0.key) }

        unwatchItem()
        watch(item: current)
        currentTrackId = info.trackId
        applyGain(info.gainDb)

        updateNowPlaying(
            title: info.title,
            artist: info.artist,
            isPlaying: true,
            coverUrl: info.coverUrl.isEmpty ? nil : info.coverUrl,
            duration: info.duration > 0 ? info.duration : nil,
            position: 0
        )
        notifyListeners("trackAdvanced", data: ["trackId": info.trackId])
    }

    @objc private func playerDidFinishPlaying(_ note: Notification) {
        guard let item = note.object as? AVPlayerItem, let player = avPlayer else { return }
        // Already rolled into the next song, or about to (one is queued): this is
        // not the end of playback. Only the last song in the queue ends it.
        if item !== player.currentItem { return }
        if player.items().count > 1 { return }
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

// Streams googlevideo audio (YouTube's audio servers) to AVPlayer.
//
// Handed a googlevideo URL directly, AVPlayer fetched it with CoreMedia's own
// "AppleCoreMedia" User-Agent and one open-ended request. googlevideo answers that
// with HTTP 403 (CoreMedia error -12660): a URL is issued to a particular YouTube
// client (the "c" parameter: IOS, ANDROID, TVHTML5...) and only plays for a matching
// User-Agent. It also slows a single long download to a trickle after the first
// burst. So, as the Android app (GoogleVideoChunkedDataSource) and the Windows app
// (audio_proxy.rs) already do, the audio is fetched here: in 1 MB pieces given as a
// "range=start-end" query parameter, with the User-Agent of the client the URL was
// made for. AVPlayer is given the same URL with the scheme "frfgv", which makes it
// ask this loader for the bytes instead of going to the network itself.
final class GoogleVideoLoader: NSObject, AVAssetResourceLoaderDelegate {
    static let scheme = "frfgv"
    private static let firstChunk: Int64 = 256 * 1024 // small first piece: starts sooner
    private static let chunk: Int64 = 1024 * 1024

    let queue = DispatchQueue(label: "com.frf.music.gvloader")
    private let source: URL
    private let userAgent: String
    private var mime: String
    private var totalLength: Int64 = -1
    private let session: URLSession
    // Loading requests AVPlayer cancelled; their remaining pieces are not fetched.
    private var cancelled = Set<ObjectIdentifier>()
    private var running: [ObjectIdentifier: URLSessionDataTask] = [:]

    static func isGoogleVideo(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host.hasSuffix("googlevideo.com") && (url.scheme == "https" || url.scheme == "http")
    }

    /// The User-Agent googlevideo expects for the client a URL was issued to.
    static func userAgent(for url: URL) -> String {
        let client = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "c" })?.value?.uppercased() ?? ""
        if client.hasPrefix("IOS") {
            return "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_5 like Mac OS X; en_US)"
        }
        if client.hasPrefix("ANDROID_VR") {
            return "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        }
        if client.hasPrefix("ANDROID_MUSIC") {
            return "com.google.android.apps.youtube.music/6.40.52 (Linux; U; Android 14; en_US) gzip"
        }
        if client.hasPrefix("ANDROID") {
            return "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
        }
        // Web, mobile web and TV clients: a browser, as on Android and Windows.
        return "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
    }

    init(source: URL) {
        // A local first: Swift does not allow reading self before super.init().
        let agent = GoogleVideoLoader.userAgent(for: source)
        self.source = source
        self.userAgent = agent
        let items = URLComponents(url: source, resolvingAgainstBaseURL: false)?.queryItems ?? []
        self.mime = items.first(where: { $0.name == "mime" })?.value ?? "audio/mp4"
        if let clen = items.first(where: { $0.name == "clen" })?.value, let n = Int64(clen), n > 0 {
            self.totalLength = n
        }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.httpAdditionalHeaders = ["User-Agent": agent]
        self.session = URLSession(configuration: config)
        super.init()
    }

    deinit {
        session.invalidateAndCancel()
    }

    /// An asset that streams `url` through a new loader. Keep the loader alive as
    /// long as the asset is used: the resource loader holds its delegate weakly.
    static func makeAsset(for url: URL) -> (asset: AVURLAsset, loader: GoogleVideoLoader)? {
        // The same address with this scheme, character for character, so AVPlayer
        // asks this loader for the bytes.
        let text = url.absoluteString
        guard let colon = text.firstIndex(of: ":"),
              let custom = URL(string: scheme + String(text[colon...])) else { return nil }
        let loader = GoogleVideoLoader(source: url)
        let asset = AVURLAsset(url: custom)
        asset.resourceLoader.setDelegate(loader, queue: loader.queue)
        return (asset, loader)
    }

    // Appended to the address as it is: rebuilding it would re-encode its signed
    // parameters. (The resolver never adds a range of its own.)
    private func pieceUrl(from: Int64, to: Int64) -> URL {
        let base = source.absoluteString
        let joiner = base.contains("?") ? "&" : "?"
        return URL(string: base + joiner + "range=\(from)-\(to)") ?? source
    }

    private func uti(for mime: String) -> String {
        let m = mime.lowercased()
        if m.contains("webm") { return "org.webmproject.webm" }
        if m.contains("mpeg") { return "public.mp3" }
        return "com.apple.m4a-audio"
    }

    // MARK: AVAssetResourceLoaderDelegate

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        let id = ObjectIdentifier(loadingRequest)
        cancelled.remove(id)
        withTotalLength { [weak self] ok in
            guard let self = self else { return }
            guard ok, self.totalLength > 0 else {
                loadingRequest.finishLoading(with: NSError(
                    domain: "GoogleVideoLoader", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Could not read the audio stream's size"]))
                return
            }
            if let info = loadingRequest.contentInformationRequest {
                info.contentType = self.uti(for: self.mime)
                info.contentLength = self.totalLength
                info.isByteRangeAccessSupported = true
            }
            guard let data = loadingRequest.dataRequest else {
                loadingRequest.finishLoading()
                return
            }
            let start = data.currentOffset != 0 ? data.currentOffset : data.requestedOffset
            var end = self.totalLength - 1
            if !data.requestsAllDataToEndOfResource {
                end = min(end, data.requestedOffset + Int64(data.requestedLength) - 1)
            }
            if start > end {
                loadingRequest.finishLoading()
                return
            }
            self.fetch(loadingRequest, from: start, to: end, first: true)
        }
        return true
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        didCancel loadingRequest: AVAssetResourceLoadingRequest
    ) {
        let id = ObjectIdentifier(loadingRequest)
        cancelled.insert(id)
        running.removeValue(forKey: id)?.cancel()
    }

    // MARK: Fetching

    /// The stream's size, from the URL's "clen" or else a HEAD request. Runs `done` on the loader queue.
    private func withTotalLength(_ done: @escaping (Bool) -> Void) {
        if totalLength > 0 {
            done(true)
            return
        }
        var request = URLRequest(url: source)
        request.httpMethod = "HEAD"
        session.dataTask(with: request) { [weak self] _, response, _ in
            guard let self = self else { return }
            self.queue.async {
                if let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) {
                    if http.expectedContentLength > 0 { self.totalLength = http.expectedContentLength }
                    if let type = http.value(forHTTPHeaderField: "Content-Type"), !type.isEmpty { self.mime = type }
                }
                done(self.totalLength > 0)
            }
        }.resume()
    }

    /// Sends bytes from..to (inclusive) to the request, one piece at a time.
    private func fetch(_ loadingRequest: AVAssetResourceLoadingRequest, from: Int64, to: Int64, first: Bool) {
        let id = ObjectIdentifier(loadingRequest)
        if cancelled.contains(id) || loadingRequest.isFinished || loadingRequest.isCancelled { return }
        let size = first ? GoogleVideoLoader.firstChunk : GoogleVideoLoader.chunk
        let pieceEnd = min(to, from + size - 1)
        let task = session.dataTask(with: pieceUrl(from: from, to: pieceEnd)) { [weak self] body, response, error in
            guard let self = self else { return }
            self.queue.async {
                self.running.removeValue(forKey: id)
                if self.cancelled.contains(id) || loadingRequest.isFinished || loadingRequest.isCancelled { return }
                if let error = error {
                    loadingRequest.finishLoading(with: error)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200...299).contains(status), let body = body, !body.isEmpty else {
                    loadingRequest.finishLoading(with: NSError(
                        domain: "GoogleVideoLoader", code: status,
                        userInfo: [NSLocalizedDescriptionKey: "googlevideo HTTP \(status)"]))
                    return
                }
                // Never hand over more than was asked for.
                let wanted = Int(pieceEnd - from + 1)
                let piece = body.count > wanted ? body.subdata(in: 0..<wanted) : body
                loadingRequest.dataRequest?.respond(with: piece)
                let next = from + Int64(piece.count)
                if next > to {
                    loadingRequest.finishLoading()
                } else {
                    self.fetch(loadingRequest, from: next, to: to, first: false)
                }
            }
        }
        running[id] = task
        task.resume()
    }
}
