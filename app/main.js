import { initShell } from "./shell/shell.js";
import { initPageNavPanel } from "./shell/page-nav.js";
import { initConverterApp } from "./converter-app.js";

initShell();
// 0.12.1 always injects #page-nav; this converter page has no section outline.
initPageNavPanel("#page-nav")?.destroy();
document.getElementById("page-nav")?.remove();
initConverterApp();
