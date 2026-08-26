import { initShell } from "./shell/shell.js";
import { initPageNavPanel } from "./shell/page-nav.js";
import { initAboutDialog } from "./components/about-dialog.js";
import { initPopover } from "./components/popover.js";
import { initTutorial } from "./components/tutorial.js";
import { initConverterApp } from "./converter-app.js";

const TOUR_HINT_STORAGE_KEY = "pbi-tabulator-tour-hint-seen";

initShell({ headingLinks: false });
// Framework still always injects #page-nav; omit it for this app.
initPageNavPanel("#page-nav")?.destroy();
document.getElementById("page-nav")?.remove();
initConverterApp();

const aboutOpenBtn = document.getElementById("about-open-btn");

/** @type {ReturnType<typeof initPopover> | null} */
let tourHintPopover = null;

function hasSeenTourHint() {
  try {
    return localStorage.getItem(TOUR_HINT_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markTourHintSeen() {
  try {
    localStorage.setItem(TOUR_HINT_STORAGE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

function dismissTourHint() {
  if (!tourHintPopover) return;
  const popover = tourHintPopover;
  tourHintPopover = null;
  markTourHintSeen();
  popover.destroy();
}

const aboutDialog = initAboutDialog({
  dialogEl: document.getElementById("about-dialog"),
  openTriggers: [aboutOpenBtn],
  onOpen: () => dismissTourHint(),
});

const tour = initTutorial({
  id: "tabulator-overview",
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
      when: () => {
        const el = document.getElementById("config-section");
        return el instanceof HTMLElement && !el.hidden;
      },
      target: "#config-section",
      title: "Column types",
      body: "Optionally set the column types, which reflects in the output column definition. Tabulator will attempt to define the types automatically.",
      position: "bottom",
    },
  ],
});

document.getElementById("start-tour-btn")?.addEventListener("click", (event) => {
  event.preventDefault();
  dismissTourHint();
  aboutDialog?.closeDialog();
  tour?.start();
});

if (aboutOpenBtn instanceof HTMLElement && !hasSeenTourHint()) {
  tourHintPopover = initPopover({
    anchor: aboutOpenBtn,
    body: "Check here for more info and a guided tour!",
    position: "right",
    dismissible: false,
    trapFocus: false,
    actions: [
      {
        label: "Got it",
        className: "btn btn-primary",
        closeOnClick: false,
        onClick: () => dismissTourHint(),
      },
    ],
    onClose: () => {
      // Escape / outside click / × — destroy after close() returns.
      if (!tourHintPopover) return;
      const popover = tourHintPopover;
      tourHintPopover = null;
      markTourHintSeen();
      queueMicrotask(() => popover.destroy());
    },
  });
  // Let shell / layout settle before measuring the anchor.
  window.requestAnimationFrame(() => {
    tourHintPopover?.open();
  });
}
