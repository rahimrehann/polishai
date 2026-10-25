// Draws the menu-bar icon: a bold "P" with a small sparkle, black on transparent.
// macOS tints "Template" images to match the menu bar (light or dark).
//   swiftc scripts/make-tray-icon.swift -o /tmp/make-tray-icon && /tmp/make-tray-icon assets
import Cocoa

func render(size: Int, to path: String) {
    let s = CGFloat(size)
    let image = NSImage(size: NSSize(width: s, height: s))
    image.lockFocus()

    let font = NSFont.systemFont(ofSize: s * 0.92, weight: .heavy)
    let text = NSAttributedString(string: "P", attributes: [.font: font, .foregroundColor: NSColor.black])
    let textSize = text.size()
    text.draw(at: NSPoint(x: (s - textSize.width) / 2 - s * 0.07, y: (s - textSize.height) / 2 - s * 0.02))

    // Four-point sparkle, top right.
    let center = NSPoint(x: s * 0.80, y: s * 0.76)
    let reach = s * 0.19
    let waist = reach * 0.30
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

    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try? png.write(to: URL(fileURLWithPath: path))
}

let folder = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
render(size: 22, to: "\(folder)/trayTemplate.png")
render(size: 44, to: "\(folder)/trayTemplate@2x.png")
