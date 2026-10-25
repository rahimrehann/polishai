window.hud.onUpdate(({ kind, text }) => {
  document.getElementById("pill").dataset.kind = kind;
  document.getElementById("label").textContent = text;
});
