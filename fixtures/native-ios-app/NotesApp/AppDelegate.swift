import UIKit
import Sentry

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        SentrySDK.start { options in
            options.dsn = "https://example.ingest.sentry.io/1"
        }
        return true
    }
}
