// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ImageBatchCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "ImageBatchCore", targets: ["ImageBatchCore"])],
    targets: [
        .target(name: "ImageBatchCore"),
        .testTarget(name: "ImageBatchCoreTests", dependencies: ["ImageBatchCore"])
    ]
)
