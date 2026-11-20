// The page's one enhancement: copy buttons on the code samples. Without
// JavaScript the buttons stay hidden and the code can still be selected.
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-copy]",
)) {
  const source = document.getElementById(button.dataset.copy ?? "");
  if (source === null || !("clipboard" in navigator)) {
    continue;
  }
  button.hidden = false;
  button.setAttribute(
    "aria-label",
    `Copy the ${button.previousElementSibling?.textContent ?? ""} sample`,
  );
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(source.textContent).then(() => {
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 2000);
    });
  });
}
