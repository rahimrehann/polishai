// Draws the menu-bar icon: a bold "P" with a small sparkle, black on transparent.
// macOS tints "Template" images to match the menu bar (light or dark).
// The menu bar is about 18 points tall, so the files are exactly 18 and 36 pixels.
//   swiftc scripts/make-tray-icon.swift -o /tmp/make-tray-icon && /tmp/make-tray-icon assets
import Cocoa

func render(pixels: Int, scale: CGFloat, to path: String) {
    // Drawing coordinates are in points; the Retina file just has twice the pixels.
    let s = CGFloat(pixels) / scale
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    ) else { exit(1) }
    rep.size = NSSize(width: s, height: s)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let font = NSFont.systemFont(ofSize: s * 0.80, weight: .heavy)
    let text = NSAttributedString(string: "P", attributes: [.font: font, .foregroundColor: NSColor.black])
    let textSize = text.size()
    text.draw(at: NSPoint(x: (s - textSize.width) / 2 - s * 0.08, y: (s - textSize.height) / 2 - s * 0.01))

    // Four-point sparkle, top right.
    let center = NSPoint(x: s * 0.80, y: s * 0.77)
    let reach = s * 0.19
    let waist = reach * 0.32
    let star = NSBezierPath()
    star.move(to: NSPoint(x: center.x, y: center.y + reach))
    star.line(to: NSPoint(x: center.x + waist, y: center.y + waist))
    star.line(to: NSPoint(x: center.x + reach, y: center.y))
    star.line(to: NSPoint(x: center.x + waist, y: center.y - waist))
    star.line(to: NSPoint(x: center.x, y: center.y - reach))
    star.line(to: NSPoint(x: center.x - waist, y: center.y - waist))
    star.line(to: NSPoint(x: center.x - reach, y: center.y))
    star.line(to: NSPoint(x: center.x - waist, y: center.y + waist))
    star.close()
    NSColor.black.setFill()
    star.fill()

    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try? png.write(to: URL(fileURLWithPath: path))
}

let folder = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
render(pixels: 18, scale: 1, to: "\(folder)/trayTemplate.png")
render(pixels: 36, scale: 2, to: "\(folder)/trayTemplate@2x.png")
