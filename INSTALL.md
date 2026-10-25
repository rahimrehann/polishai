# Installing PolishAI on a Mac

PolishAI rewrites the text you select, in any app. You select text, press a shortcut, and it is replaced with a cleaner version. It needs **macOS 13 (Ventura) or newer**.

## 1. Download the right file

Go to the [Releases page](https://github.com/rahimrehann/polishai/releases) and download one file:

| Your Mac | Download |
|---|---|
| Apple Silicon (M1, M2, M3, M4 or newer) | `PolishAI-…-mac-arm64.dmg` |
| Intel | `PolishAI-…-mac-x64.dmg` |

Not sure which you have? Click the Apple menu, then **About This Mac**. If it says **Chip: Apple M…** you have Apple Silicon. If it says **Processor: Intel…** you have an Intel Mac.

## 2. Install it

1. Double-click the downloaded `.dmg` file.
2. Drag **PolishAI** onto the **Applications** folder in the window that opens.
3. Close the window, and eject the PolishAI disk from the Finder sidebar.

## 3. Open it the first time

PolishAI is not signed by Apple yet (that needs a paid Apple developer account), so macOS shows a warning the first time. This is expected. You only do this once.

**On macOS 15 (Sequoia) or newer**
1. Open **PolishAI** from Applications. macOS says it can't verify the app. Click **Done**.
2. Open **System Settings → Privacy & Security** and scroll down to the **Security** section.
3. Next to "PolishAI was blocked", click **Open Anyway**, then enter your password.
4. Open PolishAI again and click **Open**.

**On macOS 13 or 14**
1. In Applications, hold **Control** and click **PolishAI**, then choose **Open**.
2. Click **Open** in the box that appears.

**If macOS says the app "is damaged"**, open **Terminal** and paste this, then open the app again:

```
xattr -dr com.apple.quarantine /Applications/PolishAI.app
```

## 4. Create your account

Click **Create an account**, enter your name, email and a password (8 or more characters with upper and lower case letters, a number and a symbol), then enter the code we email you.

## 5. Allow PolishAI to copy and paste for you

To rewrite text in other apps, PolishAI presses Copy and Paste for you. macOS needs your permission for that:

1. Click **Allow access** on the home screen (or **Settings → Permissions → Open settings**).
2. In **System Settings → Privacy & Security → Accessibility**, switch **PolishAI** on.

## 6. Use it

1. Select some text in any app: Notes, Mail, Slack, a web page, anywhere.
2. Press **Control + Q** for a casual **message** rewrite, or **Control + Y** for a polished **email**.
3. A small pill appears at the top of your screen while it works, and your text is replaced.

You can change both shortcuts in **Settings → Shortcuts**. PolishAI lives in your menu bar, so the shortcuts keep working with its window closed. Turn on **Settings → General → Start PolishAI when I log in** to have it ready after a restart.

## Free rewrites and your own key

Without your own key, PolishAI uses a shared Gemini key with a limit of 20 rewrites a day per person. For no limit, add your own key from Gemini, OpenAI or Anthropic in **Settings → AI provider**.

## If something doesn't work

| What happens | What to try |
|---|---|
| Nothing happens when you press the shortcut | Check **Settings → Permissions**. PolishAI must be switched on under Accessibility. If you rebuilt or reinstalled the app, remove PolishAI from that list and add it again. |
| "Select some text first" | The app you're in didn't let PolishAI copy. Make sure text is highlighted, and click once in the app first. |
| "You've used all 20 free rewrites" | Wait until tomorrow, or add your own key in Settings. |
| macOS asks if "PolishAI wants to use your confidential information stored in 'PolishAI Safe Storage'" | This happens after you install an update. It's PolishAI's own saved-login protection. Enter your Mac password and click **Always Allow**. |
| The shortcut does something else | Another app uses the same keys. Pick a different shortcut in Settings. |
| It says the app is out of date | Download the newest version from the Releases page. |

## Your data

Your History (the full text of what you wrote and what PolishAI wrote) is stored only on your computer, encrypted. Our servers keep your account and simple counts, not your text. Read **Settings → Privacy and your data** for the full notice. **Settings → Delete my account** removes everything.

## Removing PolishAI

1. In PolishAI, open **Settings → Delete my account** if you want your account and data removed.
2. Click the PolishAI icon in the menu bar and choose **Quit PolishAI**.
3. Drag **PolishAI** from Applications to the Trash.
4. Optional: delete the folder `~/Library/Application Support/PolishAI`.
