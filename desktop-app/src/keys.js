// Presses Copy/Paste in other apps through the small native helper.
function createKeys({ execFile, helperPath }) {
  function run(args, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      execFile(helperPath, args, { timeout: timeoutMs }, (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout).trim());
      });
    });
  }

  return {
    copy: () => run(["copy"]),
    paste: () => run(["paste"]),
    frontApp: () => run(["frontapp"]),
    // Resolves true once the shortcut's own keys are let go (so ⌃ isn't still down when we press ⌘C).
    waitModifiersUp: async (ms) => (await run(["modifiers-up", String(ms)], ms + 1500)) === "1",
  };
}

module.exports = { createKeys };
