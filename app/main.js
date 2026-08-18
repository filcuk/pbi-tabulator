import { initShell } from "./shell/shell.js";
import { initPageNavPanel } from "./shell/page-nav.js";
import { initConverterApp } from "./converter-app.js";

initShell();
// 0.12.1 always injects #page-nav and heading copy-link buttons.
initPageNavPanel("#page-nav")?.destroy();
document.getElementById("page-nav")?.remove();
for (const btn of document.querySelectorAll(".heading-link-btn")) btn.remove();
for (const heading of document.querySelectorAll(".heading-anchor")) {
  heading.classList.remove("heading-anchor");
  delete heading.dataset.headingLink;
}
initConverterApp();
