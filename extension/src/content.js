// Polish - content script

const BACKEND_URL = "https://zrixwg6huied4ttlcdhxuoa2mq0lnnkf.lambda-url.us-east-1.on.aws/";

let toolbar = null;
let activeRange = null;
let selectedFormat = "message";
let lastSelectedText = "";
let interactingWithToolbar = false;

function injectStyles() {
  if (document.getElementById("polish-styles")) return;

  const style = document.createElement("style");
  style.id = "polish-styles";
  style.textContent = `
    #polish-toolbar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 4px;
      background: linear-gradient(180deg, #1c1c1c 0%, #000000 100%);
      padding: 5px;
      border-radius: 999px;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.06),
        0 14px 28px rgba(0, 0, 0, 0.45),
        0 4px 10px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #polish-toolbar::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 999px;
      padding: 1px;
      background: conic-gradient(
        from 180deg,
        rgba(255,255,255,0.02),
        rgba(255,255,255,0.35),
        rgba(255,255,255,0.02) 30%
      );
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }

    .polish-pill {
      position: relative;
      border: none;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: transparent;
      color: #999999;
      transition: all 0.2s ease;
    }

    .polish-pill:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }

    .polish-pill.active {
      background: #ffffff;
      color: #111111;
    }

    #polish-reword-button {
      position: relative;
      overflow: hidden;
      border: none;
      border-radius: 999px;
      padding: 7px 16px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: #f0f0f0;
      background:
        linear-gradient(
          120deg,
          rgba(255,255,255,0) 20%,
          rgba(255,255,255,0.35) 50%,
          rgba(255,255,255,0) 80%
        ),
        linear-gradient(180deg, #2a2a2a 0%, #0a0a0a 100%);
      background-size: 200% 100%, 100% 100%;
      background-position: -150% 0, 0 0;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.1),
        0 3px 8px rgba(0, 0, 0, 0.4);
      transition: box-shadow 0.15s ease, transform 0.15s ease;
      animation: polish-shine 3s ease-in-out infinite;
    }

    @keyframes polish-shine {
      0% { background-position: -150% 0, 0 0; }
      50% { background-position: 250% 0, 0 0; }
      100% { background-position: 250% 0, 0 0; }
    }

    #polish-reword-button:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.18),
        0 6px 14px rgba(0, 0, 0, 0.5);
    }

    #polish-reword-button:active:not(:disabled) {
      transform: translateY(0) scale(0.97);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.1),
        0 1px 3px rgba(0, 0, 0, 0.4);
    }

    #polish-reword-button:disabled {
      color: #777777;
      cursor: default;
      animation: none;
      background:
        linear-gradient(180deg, #1a1a1a 0%, #050505 100%);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05);
    }
  `;
  document.head.appendChild(style);
}

function removeToolbar() {
  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }
}

function showToolbar(selection) {
  removeToolbar();
  injectStyles();

  const range = selection.getRangeAt(0);
  activeRange = range;
  const rect = range.getBoundingClientRect();

  toolbar = document.createElement("div");
  toolbar.id = "polish-toolbar";
  toolbar.style.position = "absolute";
  toolbar.style.top = `${window.scrollY + rect.top - 46}px`;
  toolbar.style.left = `${window.scrollX + rect.right - 230}px`;
  toolbar.style.zIndex = "2147483647";

  const messagePill = createPill("Message", "message");
  const emailPill = createPill("Email", "email");
  const rewordButton = createRewordButton();

  toolbar.appendChild(messagePill);
  toolbar.appendChild(emailPill);
  toolbar.appendChild(rewordButton);

  document.body.appendChild(toolbar);
  updatePillStyles();
}

function createPill(label, formatValue) {
  const pill = document.createElement("button");
  pill.textContent = label;
  pill.className = "polish-pill";
  pill.dataset.format = formatValue;

  pill.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  pill.addEventListener("click", (event) => {
    event.preventDefault();
    selectedFormat = formatValue;
    updatePillStyles();
  });

  return pill;
}

function updatePillStyles() {
  if (!toolbar) return;
  const pills = toolbar.querySelectorAll(".polish-pill");
  pills.forEach((pill) => {
    if (pill.dataset.format === selectedFormat) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });
}

function createRewordButton() {
  const button = document.createElement("button");
  button.textContent = "Reword";
  button.id = "polish-reword-button";
  button.addEventListener("click", handleRewordClick);
  return button;
}

async function handleRewordClick(event) {
  const button = event.target;
  const text = activeRange.toString();
  button.textContent = "Rewording...";
  button.disabled = true;

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, format: selectedFormat }),
    });

    const data = await response.json();
    replaceSelectedText(data.result);
  } catch (error) {
    console.error("Reword failed:", error);
  }

  removeToolbar();
}

function replaceSelectedText(newText) {
  activeRange.deleteContents();

  const lines = newText.split("\n");
  const fragment = document.createDocumentFragment();

  lines.forEach((line) => {
    const div = document.createElement("div");
    if (line.trim().length === 0) {
      div.innerHTML = "&nbsp;";
    } else {
      div.textContent = line;
    }
    fragment.appendChild(div);
  });

  const lastNode = fragment.lastChild;
  activeRange.insertNode(fragment);

  const parent = lastNode ? lastNode.parentElement : null;
  if (parent) {
    const inputEvent = new InputEvent("input", { bubbles: true, cancelable: true });
    parent.dispatchEvent(inputEvent);
  }

  window.getSelection().removeAllRanges();
}

function checkSelection() {
  if (interactingWithToolbar) {
    return;
  }

  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (selectedText === lastSelectedText) {
    return;
  }
  lastSelectedText = selectedText;

  if (selectedText.length > 0) {
    showToolbar(selection);
  } else {
    removeToolbar();
  }
}

document.addEventListener("mousedown", (event) => {
  if (toolbar && toolbar.contains(event.target)) {
    interactingWithToolbar = true;
  }
});

document.addEventListener("mouseup", (event) => {
  if (toolbar && toolbar.contains(event.target)) {
    setTimeout(() => {
      interactingWithToolbar = false;
    }, 50);
    return;
  }
  setTimeout(checkSelection, 10);
});

document.addEventListener("keyup", (event) => {
  if (toolbar && toolbar.contains(event.target)) {
    return;
  }
  setTimeout(checkSelection, 10);
});

document.addEventListener("click", (event) => {
  if (toolbar && toolbar.contains(event.target)) {
    return;
  }
  setTimeout(checkSelection, 10);
});

setInterval(checkSelection, 500);