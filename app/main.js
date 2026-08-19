import { initShell } from "./shell/shell.js";
import { initPageNavPanel } from "./shell/page-nav.js";
import { initAboutDialog } from "./components/about-dialog.js";
import { initTutorial } from "./components/tutorial.js";
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

initAboutDialog({
  dialogEl: document.getElementById("about-dialog"),
  openTriggers: "#about-open-btn",
});

initTutorial({
  id: "tabulator-overview",
  startTriggers: "#start-tour-btn",
  steps: [
    {
      target: ".converter-toolbar",
      title: "Conversion selection",
      body: "Choose the source you have, the target you want, and the DAX or M flavour you want to generate.",
      position: "bottom",
    },
    {
      target: ".tabular-input-reset",
      title: "Reset input",
      body: "Clear example data from the input.",
      position: "bottom",
    },
    {
      target: ".tabular-input-footer-actions",
      title: "Overwrite input",
      body: "Or just paste over the existing data. The table will take the shape of your clipboard contents.",
      position: "bottom",
    },
    {
      target: () => {
        const el = document.getElementById("config-section");
        if (!(el instanceof HTMLElement) || el.hidden) return null;
        return el;
      },
      title: "Column types",
      body: "Optionally set the column types, which reflects in the output column definition. Tabulator will attempt to define the types automatically.",
      position: "bottom",
    },
  ],
});
