const hotkeys = require("../hotkeys");

// The menu-bar icon and its menu. `getState()` says what to show; the menu is
// rebuilt whenever something changes.
function createTray({ Tray, Menu, nativeImage, iconPath, platform, getState, actions }) {
  let tray = null;

  const show = (accelerator) => hotkeys.display(accelerator, platform).join(" ") || "none";

  function template() {
    const state = getState();
    return [
      { label: "Open PolishAI", click: () => actions.open() },
      { type: "separator" },
      { label: `Message rewrite:  ${show(state.hotkeys.message)}`, enabled: false },
      { label: `Email rewrite:  ${show(state.hotkeys.email)}`, enabled: false },
      {
        label: "Pause shortcuts",
        type: "checkbox",
        checked: state.paused,
        click: (item) => actions.setPaused(item.checked),
      },
      {
        label: state.launchSupported ? "Start PolishAI at login" : "Start at login (installed app only)",
        type: "checkbox",
        checked: state.launchAtLogin,
        enabled: state.launchSupported,
        click: (item) => actions.setLaunchAtLogin(item.checked),
      },
      { type: "separator" },
      { label: "Quit PolishAI", click: () => actions.quit() },
    ];
  }

  function refresh() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate(template()));
    tray.setToolTip(getState().paused ? "PolishAI (shortcuts paused)" : "PolishAI");
  }

  return {
    create() {
      const image = nativeImage.createFromPath(iconPath);
      tray = new Tray(image);
      refresh();
      return tray;
    },
    refresh,
    template,
    destroy() {
      if (tray) tray.destroy();
      tray = null;
    },
  };
}

module.exports = { createTray };
