// Builds every logo file from the artwork: a square master, the in-app logo (assets/logo.png) and the
// menu-bar glyph (assets/trayTemplate*.png). The app icon is built separately by make-app-icon.swift.
// The white P in the source is see-through, so it is painted white here (a see-through P would show the
// dark Dock through it). The rounded square is also made exactly square.
//   swiftc scripts/make-logo-assets.swift -o /tmp/make-logo-assets && mkdir -p /tmp/logo-out && /tmp/make-logo-assets "<logo>.png" /tmp/logo-out
import Cocoa

let args = CommandLine.arguments
guard args.count == 3, let src = NSImage(contentsOfFile: args[1]),
      let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("usage: prep <in> <outdir>"); exit(2) }
let outDir = args[2]
let w = cg.width, h = cg.height
let space = CGColorSpaceCreateDeviceRGB()
var px = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

// 1. Which transparent pixels are "outside" (reachable from the canvas edge) and which are holes in the artwork?
var outside = [Bool](repeating: false, count: w * h)
var stack = [Int]()
func alpha(_ i: Int) -> UInt8 { px[i * 4 + 3] }
for x in 0..<w { for y in [0, h - 1] { let i = y * w + x; if alpha(i) < 40 && !outside[i] { outside[i] = true; stack.append(i) } } }
for y in 0..<h { for x in [0, w - 1] { let i = y * w + x; if alpha(i) < 40 && !outside[i] { outside[i] = true; stack.append(i) } } }
while let i = stack.popLast() {
    let x = i % w, y = i / w
    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
        let nx = x + dx, ny = y + dy
        if nx < 0 || ny < 0 || nx >= w || ny >= h { continue }
        let j = ny * w + nx
        if !outside[j] && alpha(j) < 40 { outside[j] = true; stack.append(j) }
    }
}
var hole = [Bool](repeating: false, count: w * h)
var holes = 0
for i in 0..<(w * h) where !outside[i] && alpha(i) < 40 { hole[i] = true; holes += 1 }
print("hole pixels (the P and lines): \(holes)")

// 2. Paint the holes white, and blend the soft edge pixels next to them over white too.
var near = [Bool](repeating: false, count: w * h)
let r = 3
for y in 0..<h { for x in 0..<w where hole[y * w + x] {
    for dy in -r...r { for dx in -r...r {
        let nx = x + dx, ny = y + dy
        if nx >= 0 && ny >= 0 && nx < w && ny < h { near[ny * w + nx] = true }
    } }
} }
for i in 0..<(w * h) where near[i] && !outside[i] {
    let a = Int(px[i * 4 + 3])
    for c in 0..<3 { px[i * 4 + c] = UInt8(min(255, Int(px[i * 4 + c]) + (255 - a))) } // premultiplied over white
    px[i * 4 + 3] = 255
}

// 3. Crop to the rounded square and stretch it to an exact square.
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h { for x in 0..<w where !outside[y * w + x] && px[(y * w + x) * 4 + 3] > 40 {
    minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
} }
let box = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
print("artwork \(Int(box.width))x\(Int(box.height)) -> square")
let cleaned = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!.makeImage()!
let art = cleaned.cropping(to: box)!

func square(_ size: Int) -> CGImage {
    let c = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.interpolationQuality = .high
    c.draw(art, in: CGRect(x: 0, y: 0, width: size, height: size))
    return c.makeImage()!
}
func save(_ image: CGImage, _ name: String) {
    let rep = NSBitmapImageRep(cgImage: image)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/\(name)"))
    print("wrote \(name) \(image.width)x\(image.height)")
}
let master = square(1024)
save(master, "master-1024.png")
save(square(500), "master-500.png")
save(square(290), "logo-290.png")

// 4. Menu-bar glyph: only the white P, as black on transparent (macOS tints it). Template image.
var mp = [UInt8](repeating: 0, count: 1024 * 1024 * 4)
let mctx = CGContext(data: &mp, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 1024 * 4, space: space,
                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
mctx.draw(master, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
var mask = [UInt8](repeating: 0, count: 1024 * 1024 * 4)
var gx0 = 1024, gy0 = 1024, gx1 = 0, gy1 = 0
for y in 0..<1024 { for x in 0..<1024 {
    let i = (y * 1024 + x) * 4
    let a = Int(mp[i + 3])
    // how white is it? green has a low red channel, white has a high one
    let white = a > 200 ? max(0, (Int(mp[i]) - 40) * 255 / 215) : 0
    mask[i + 3] = UInt8(min(255, white))
    if white > 128 { gx0 = min(gx0, x); gx1 = max(gx1, x); gy0 = min(gy0, y); gy1 = max(gy1, y) }
} }
let gbox = CGRect(x: gx0, y: gy0, width: gx1 - gx0 + 1, height: gy1 - gy0 + 1)
print("P glyph \(Int(gbox.width))x\(Int(gbox.height))")
let maskImage = CGContext(data: &mask, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 1024 * 4, space: space,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!.makeImage()!
let glyph = maskImage.cropping(to: gbox)!
func tray(_ size: Int, _ height: CGFloat) -> CGImage {
    let c = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.interpolationQuality = .high
    let s = height / gbox.height
    let dw = gbox.width * s
    c.draw(glyph, in: CGRect(x: (CGFloat(size) - dw) / 2, y: (CGFloat(size) - height) / 2, width: dw, height: height))
    return c.makeImage()!
}
save(tray(18, 15), "trayTemplate.png")
save(tray(36, 30), "trayTemplate@2x.png")
