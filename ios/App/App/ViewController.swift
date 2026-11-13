import UIKit
import Capacitor
import WebKit

class ViewController: CAPBridgeViewController {
    // The app's own native plugins live in this target, not in an npm package, so
    // 'cap sync' does not list them (packageClassList stays empty) and Capacitor
    // never loads them by itself. Without this, "BackgroundAudio" was not
    // implemented on iOS: every song played inside the web view (an <audio>
    // element or the YouTube player), which iOS freezes when the app leaves the
    // screen, instead of on the native AVQueuePlayer that keeps playing.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BackgroundAudioPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        return config
    }
}
