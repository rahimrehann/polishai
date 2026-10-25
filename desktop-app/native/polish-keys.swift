// Small helper PolishAI uses to press Copy/Paste in other apps.
//
//   polish-keys copy                 press Cmd+C
//   polish-keys paste                press Cmd+V
//   polish-keys frontapp             print the name of the app in front
//   polish-keys trusted [--prompt]   print 1 or 0: may we control other apps?
//   polish-keys modifiers-up [ms]    wait until Control/Option/Command/Shift are released
import Cocoa
import ApplicationServices

let keyC: CGKeyCode = 8
let keyV: CGKeyCode = 9

// Types Command+<key> the way a real keyboard does: Command goes down, then the
// letter goes down and up with a short pause, then Command comes up.
// Testing showed macOS ignores the keystroke unless it uses the hardware event
// source and these small gaps.
let keyCommand: CGKeyCode = 55

func press(_ key: CGKeyCode) {
    let source = CGEventSource(stateID: .hidSystemState)

    func send(_ code: CGKeyCode, down: Bool, flags: CGEventFlags) {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
    }

    send(keyCommand, down: true, flags: .maskCommand)
    usleep(15_000)
    send(key, down: true, flags: .maskCommand)
    usleep(40_000)
    send(key, down: false, flags: .maskCommand)
    usleep(15_000)
    send(keyCommand, down: false, flags: [])
}

func modifiersHeld() -> Bool {
    let flags = CGEventSource.flagsState(.combinedSessionState)
    return !flags.intersection([.maskControl, .maskAlternate, .maskCommand, .maskShift]).isEmpty
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    FileHandle.standardError.write("usage: polish-keys copy|paste|frontapp|trusted|modifiers-up\n".data(using: .utf8)!)
    exit(2)
}

switch arguments[1] {
case "copy":
    press(keyC)
case "paste":
    press(keyV)
case "frontapp":
    print(NSWorkspace.shared.frontmostApplication?.localizedName ?? "")
case "trusted":
    let prompt = arguments.contains("--prompt")
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    print(AXIsProcessTrustedWithOptions(options) ? "1" : "0")
case "modifiers-up":
    let limit = arguments.count > 2 ? (Double(arguments[2]) ?? 1000) : 1000
    let deadline = Date().addingTimeInterval(limit / 1000)
    while modifiersHeld() && Date() < deadline {
        usleep(10_000)
    }
    print(modifiersHeld() ? "0" : "1")
default:
    FileHandle.standardError.write("unknown command\n".data(using: .utf8)!)
    exit(2)
}
