// Polish - content script
// Runs on every page. Detects text selection and injects the "Reword" button.

// TODO: listen for text selection (mouseup / selectionchange)
// TODO: on selection, show a floating button near the selected text
// TODO: on button click, send selected text to the backend (or directly to Groq)
// TODO: replace the selected text with the AI's response
//       - handle plain <textarea> / <input> (straightforward: set .value)
//       - handle contenteditable elements (Gmail, Slack, Teams use these)
//       - use synthetic input events so frameworks like React notice the change
