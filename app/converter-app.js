/**
 * Converter app: source/target switches, dialect pickers, live conversion.
 */

import { setHidden } from "./utils/dom.js";
import { initSegmentedControl } from "./components/segmented-control.js";
import { initTabularInput } from "./components/tabular-input.js";
import { initCodeBlock } from "./components/code-block.js";
import { showBanner, hideBanner } from "./components/banner.js";
import {
  ConvertError,
  generate,
  normalizeTable,
  parse,
} from "./convert/index.js";

const DEBOUNCE_MS = 280;

const SAMPLE = normalizeTable({
  columns: [
    { id: "name", label: "Name", type: "text" },
    { id: "age", label: "Age", type: "number" },
    { id: "active", label: "Active", type: "logical" },
  ],
  rows: [
    { cells: { name: "Alice", age: 30, active: true } },
    { cells: { name: "Bob", age: 25, active: false } },
  ],
});

/**
 * @param {object} [options]
 * @param {ParentNode} [options.root]
 */
export function initConverterApp({ root = document } = {}) {
  const errorBanner = root.querySelector("#convert-error");
  const errorBody = root.querySelector("#convert-error-body");
  const daxDialectField = root.querySelector("#dax-dialect-field");
  const mDialectField = root.querySelector("#m-dialect-field");
  const inputTabularWrap = root.querySelector("#input-tabular-wrap");
  const inputCodeWrap = root.querySelector("#input-code-wrap");
  const outputTabularWrap = root.querySelector("#output-tabular-wrap");
  const outputCodeWrap = root.querySelector("#output-code-wrap");

  /** @type {import("./convert/model.js").TableModel} */
  let model = SAMPLE;

  let source = "tabular";
  let target = "dax";
  let daxDialect = "datatable";
  let mDialect = "table";
  let syncing = false;
  let convertGen = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounceTimer;

  const inputTabular = initTabularInput(root.querySelector("#input-tabular"), {
    columns: model.columns,
    rows: model.rows,
    onChange({ columns, rows, source: changeSource }) {
      if (syncing || source !== "tabular") return;
      if (changeSource === "init") return;
      model = normalizeTable({ columns, rows });
      scheduleConvert();
    },
  });

  const outputTabular = initTabularInput(root.querySelector("#output-tabular"), {
    columns: model.columns,
    rows: model.rows,
    disabled: true,
  });

  const inputCode = initCodeBlock(root.querySelector("#input-code"), {
    mode: "edit",
    highlight: false,
    lineNumbers: false,
  });

  const outputCode = initCodeBlock(root.querySelector("#output-code"), {
    mode: "select",
    highlight: false,
    lineNumbers: false,
  });

  const sourceControl = initSegmentedControl(root.querySelector("#source-control"), {
    defaultValue: "tabular",
    onChange({ value, source: changeSource }) {
      if (changeSource === "init" || syncing) return;
      void onSourceChange(value);
    },
  });

  const targetControl = initSegmentedControl(root.querySelector("#target-control"), {
    defaultValue: "dax",
    onChange({ value, source: changeSource }) {
      if (changeSource === "init" || syncing) return;
      void onTargetChange(value);
    },
  });

  initSegmentedControl(root.querySelector("#dax-dialect-control"), {
    defaultValue: "datatable",
    onChange({ value, source: changeSource }) {
      if (changeSource === "init") return;
      daxDialect = value;
      void runConvert();
    },
  });

  initSegmentedControl(root.querySelector("#m-dialect-control"), {
    defaultValue: "table",
    onChange({ value, source: changeSource }) {
      if (changeSource === "init") return;
      mDialect = value;
      void runConvert();
    },
  });

  root.querySelector("#input-code")?.addEventListener(
    "input",
    () => {
      if (syncing || (source !== "dax" && source !== "m")) return;
      scheduleConvert();
    },
    true
  );

  function clearError() {
    if (errorBanner) hideBanner(errorBanner);
  }

  /** @param {string} message */
  function showError(message) {
    if (errorBody) errorBody.textContent = message;
    if (errorBanner) showBanner(errorBanner);
  }

  function scheduleConvert() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runConvert();
    }, DEBOUNCE_MS);
  }

  function updateDialectVisibility() {
    setHidden(daxDialectField, target !== "dax");
    setHidden(mDialectField, target !== "m");
  }

  function updatePaneVisibility() {
    const sourceIsTable = source === "tabular";
    const targetIsTable = target === "tabular";
    setHidden(inputTabularWrap, !sourceIsTable);
    setHidden(inputCodeWrap, sourceIsTable);
    setHidden(outputTabularWrap, !targetIsTable);
    setHidden(outputCodeWrap, targetIsTable);
  }

  /**
   * Prefer the opposite of `other` when picking a fallback lang.
   * @param {string} other
   */
  function fallbackLang(other) {
    if (other === "tabular") return "dax";
    return "tabular";
  }

  /**
   * @param {string} next
   */
  async function onSourceChange(next) {
    if (next === source) return;

    // Capture current model from outgoing source before switching
    try {
      if (source === "tabular") {
        model = normalizeTable(inputTabular?.getData() ?? model);
      } else if (source === "dax" || source === "m") {
        const text = inputCode?.getSource() ?? "";
        if (text.trim()) {
          model = normalizeTable(await parse(source, text));
        }
      }
      clearError();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      // Revert segmented control
      syncing = true;
      sourceControl?.selectValue(source, { emit: false });
      syncing = false;
      return;
    }

    source = next;
    if (source === target) {
      target = fallbackLang(source);
      syncing = true;
      targetControl?.selectValue(target, { emit: false });
      syncing = false;
    }

    updateDialectVisibility();
    updatePaneVisibility();

    syncing = true;
    try {
      if (source === "tabular") {
        inputTabular?.setData(model, { emitEvent: false });
      } else {
        const dialect = source === "dax" ? daxDialect : mDialect;
        const code = await generate(source, dialect, model);
        inputCode?.setSource(String(await code));
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      syncing = false;
    }

    await runConvert();
  }

  /**
   * @param {string} next
   */
  async function onTargetChange(next) {
    if (next === target) return;

    target = next;
    if (target === source) {
      source = fallbackLang(target);
      syncing = true;
      sourceControl?.selectValue(source, { emit: false });
      // Refresh input pane for new source from current model
      try {
        if (source === "tabular") {
          inputTabular?.setData(model, { emitEvent: false });
        } else {
          const dialect = source === "dax" ? daxDialect : mDialect;
          const code = await generate(source, dialect, model);
          inputCode?.setSource(String(await code));
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      syncing = false;
    }

    updateDialectVisibility();
    updatePaneVisibility();
    await runConvert();
  }

  async function runConvert() {
    const gen = ++convertGen;

    try {
      if (source === "tabular") {
        model = normalizeTable(inputTabular?.getData() ?? model);
      } else if (source === "dax" || source === "m") {
        const text = inputCode?.getSource() ?? "";
        if (!text.trim()) {
          throw new ConvertError(`${source.toUpperCase()} input is empty`);
        }
        model = normalizeTable(await parse(source, text));
      }

      if (gen !== convertGen) return;

      syncing = true;
      if (target === "tabular") {
        outputTabular?.setData(model, { emitEvent: false });
        outputTabular?.setDisabled(true);
      } else if (target === "dax" || target === "m") {
        const dialect = target === "dax" ? daxDialect : mDialect;
        const code = await generate(target, dialect, model);
        if (gen !== convertGen) return;
        outputCode?.setSource(String(await code));
      }
      syncing = false;
      clearError();
    } catch (err) {
      syncing = false;
      if (gen !== convertGen) return;
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  updateDialectVisibility();
  updatePaneVisibility();
  void runConvert();

  return {
    getModel: () => model,
    refresh: () => runConvert(),
  };
}
