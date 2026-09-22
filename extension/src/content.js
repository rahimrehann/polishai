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
    @import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700&display=swap');

    #polish-toolbar-wrapper {
      position: relative;
      padding: 2px;
      border-radius: 999px;
      overflow: hidden;
    }

    #polish-toolbar-wrapper::before {
      content: "";
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: conic-gradient(
        rgba(255,255,255,0.05) 0deg,
        rgba(255,255,255,0.05) 200deg,
        rgba(255,255,255,0.7) 260deg,
        rgba(255,255,255,0.05) 320deg,
        rgba(255,255,255,0.05) 360deg
      );
      animation: polish-spin 4s linear infinite;
    }

    @keyframes polish-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    #polish-toolbar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px;
      border-radius: 999px;
      background: linear-gradient(180deg, #1c1c1c 0%, #000000 100%);
      box-shadow:
        0 0 0 2px rgba(0, 0, 0, 0.15),
        0 14px 28px rgba(0, 0, 0, 0.45),
        0 4px 10px rgba(0, 0, 0, 0.3);
      font-family: 'Figtree', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

  const wrapper = document.createElement("div");
  wrapper.id = "polish-toolbar-wrapper";
  wrapper.style.position = "absolute";
  wrapper.style.top = `${window.scrollY + rect.top - 48}px`;
  wrapper.style.left = `${window.scrollX + rect.right - 232}px`;
  wrapper.style.zIndex = "2147483647";

  toolbar = document.createElement("div");
  toolbar.id = "polish-toolbar";

  const messagePill = createPill("Message", "message");
  const emailPill = createPill("Email", "email");
  const rewordButton = createRewordButton();

  toolbar.appendChild(messagePill);
  toolbar.appendChild(emailPill);
  toolbar.appendChild(rewordButton);

  wrapper.appendChild(toolbar);
  document.body.appendChild(wrapper);
  updatePillStyles();
}

function createPill(label, formatValue) {
  const pill = document.createElement("button");
  pill.textContent = label;
  pill.className = "polish-pill";
  pill.dataset.format = formatValue;
  pill.setAttribute("tabindex", "-1");

  pill.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  pill.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
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
  button.textContent = "ReWord";
  button.id = "polish-reword-button";
  button.setAttribute("tabindex", "-1");

  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handleRewordClick(event);
  });
  return button;
}

function getStoredToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["idToken", "accessToken"], (result) => {
      resolve(result.accessToken || null);
    });
  });
}

async function handleRewordClick(event) {
  const button = event.target;
  const text = activeRange.toString();

  const token = await getStoredToken();

  if (!token) {
    button.textContent = "Log in first";
    setTimeout(() => {
      removeToolbar();
    }, 1500);
    return;
  }

  button.textContent = "Rewording...";
  button.disabled = true;

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ text: text, format: selectedFormat }),
    });

    if (response.status === 401) {
      button.textContent = "Session expired, log in again";
      setTimeout(() => {
        removeToolbar();
      }, 2000);
      return;
    }

    const data = await response.json();
    replaceSelectedText(data.result);
    removeToolbar();
  } catch (error) {
    console.error("Reword failed:", error);
    removeToolbar();
  }
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
}, true);

document.addEventListener("mouseup", (event) => {
  if (toolbar && toolbar.contains(event.target)) {
    setTimeout(() => {
      interactingWithToolbar = false;
    }, 50);
    return;
  }
  setTimeout(checkSelection, 10);
}, true);

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