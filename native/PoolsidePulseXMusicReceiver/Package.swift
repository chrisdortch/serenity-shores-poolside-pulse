// swift-tools-version: 5.8

import PackageDescription

let package = Package(
    name: "PoolsidePulseXMusicReceiver",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PoolsidePulseXMusicReceiver", targets: ["PoolsidePulseXMusicReceiver"])
    ],
    targets: [
        .executableTarget(
            name: "PoolsidePulseXMusicReceiver",
            path: "Sources/PoolsidePulseXMusicReceiver"
        )
    ]
)
