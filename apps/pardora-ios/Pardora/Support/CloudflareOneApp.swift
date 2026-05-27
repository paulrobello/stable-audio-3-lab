import SwiftUI

enum CloudflareOneApp {
    static let url = URL(string: "cf1app://oneapp.cloudflare.com")!
    static let appStoreURL = URL(string: "https://apps.apple.com/us/app/cloudflare-one-agent/id6443476492")!
}

struct CloudflareOneButton: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            openURL(CloudflareOneApp.url) { accepted in
                if !accepted {
                    openURL(CloudflareOneApp.appStoreURL)
                }
            }
        } label: {
            Label("Open Cloudflare One", systemImage: "shield.lefthalf.filled")
        }
    }
}
