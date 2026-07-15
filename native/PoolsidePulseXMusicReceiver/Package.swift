// swift-tools-version: 5.8

import PackageDescription

let package = Package(
    name: "PoolsidePulseXMusicReceiver",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "ReceiverCore", targets: ["ReceiverCore"]),
        .executable(name: "PoolsidePulseXMusicReceiver", targets: ["PoolsidePulseXMusicReceiver"])
    ],
    targets: [
        .target(
            name: "ReceiverCore",
            path: "Sources/ReceiverCore"
        ),
        .executableTarget(
            name: "PoolsidePulseXMusicReceiver",
            dependencies: ["ReceiverCore"],
            path: "Sources/PoolsidePulseXMusicReceiver"
        ),
        .testTarget(
            name: "ReceiverCoreTests",
            dependencies: ["ReceiverCore"],
            path: "Tests/ReceiverCoreTests"
        )
    ]
)
