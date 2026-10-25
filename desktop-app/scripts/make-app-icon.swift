// Builds the app icon from the logo: finds the artwork inside the logo file,
// centres it on a transparent 1024 square with the standard macOS margin, and
// writes build-resources/icon-1024.png (then `iconutil` makes the .icns).
//   swiftc scripts/make-app-icon.swift -o /tmp/make-app-icon && /tmp/make-app-icon "PolishAI Logo.png" build-resources/icon-1024.png
import Cocoa

let args = CommandLine.arguments
guard args.count == 3, let source = NSImage(contentsOfFile: args[1]),
      let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("usage: make-app-icon <logo.png> <out.png>")
    exit(2)
}

// Find the artwork: every pixel that is not (nearly) transparent and not near-white.
let width = cg.width, height = cg.height
var pixels = [UInt8](repeating: 0, count: width * height * 4)
let space = CGColorSpaceCreateDeviceRGB()
let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))

var minX = width, minY = height, maxX = 0, maxY = 0
for y in 0..<height {
    for x in 0..<width {
        let i = (y * width + x) * 4
        let a = Int(pixels[i + 3])
        let isWhite = pixels[i] > 235 && pixels[i + 1] > 235 && pixels[i + 2] > 235
        if a > 40 && !isWhite {
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        }
    }
}
let box = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
print("logo \(width)x\(height), artwork at x:\(minX)-\(maxX) y:\(minY)-\(maxY) (\(Int(box.width))x\(Int(box.height)))")

// CGImage crops from the top-left; our scan used the same orientation for rows.
guard let art = cg.cropping(to: box) else { exit(1) }

let canvas = 1024
let artSize: CGFloat = 824 // the macOS icon grid leaves a margin around the artwork
guard let out = CGContext(data: nil, width: canvas, height: canvas, bitsPerComponent: 8, bytesPerRow: 0,
                          space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
out.interpolationQuality = .high
// Keep the artwork's own proportions: scale the longer side to artSize.
let scale = artSize / max(box.width, box.height)
let drawnWidth = box.width * scale
let drawnHeight = box.height * scale
out.draw(art, in: CGRect(x: (CGFloat(canvas) - drawnWidth) / 2, y: (CGFloat(canvas) - drawnHeight) / 2,
                         width: drawnWidth, height: drawnHeight))

guard let image = out.makeImage() else { exit(1) }
let rep = NSBitmapImageRep(cgImage: image)
try? rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2])")
