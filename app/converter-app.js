/**
 * Converter app: source/target switches, dialect pickers, live conversion.
 */

import { setHidden } from "./utils/dom.js";
import { initSegmentedControl } from "./components/segmented-control.js";
import { initTabularInput } from "./components/tabular-input.js";
import { initTable } from "./components/table.js";
import { initCodeBlock } from "./components/code-block.js";
import { initToggle } from "./components/toggle.js";
import { showBanner, hideBanner } from "./components/banner.js";
import {
  ConvertError,
  generate,
  normalizeTable,
  parse,
} from "./convert/index.js";
import {
  isValidOutputType,
  outputTypeOptions,
  remapOutputType,
  suggestOutputType,
} from "./convert/output-types.js";

const DEBOUNCE_MS = 280;

/**
 * Prism language id for a converter lang (`dax` | `m`).
 * @param {string} lang
 * @returns {string | null}
 */
function prismLanguage(lang) {
  if (lang === "dax") return "dax";
  if (lang === "m") return "powerquery";
  return null;
}

const SAMPLE = normalizeTable({
  columns: [
    { id: "name", label: "Name", type: "text" },
    { id: "qty", label: "Qty", type: "number" },
    { id: "rate", label: "Rate", type: "number" },
    { id: "active", label: "Active", type: "logical" },
    { id: "amount", label: "Amount", type: "number" },
    { id: "day", label: "Day", type: "text" },
    { id: "updated", label: "Updated", type: "text" },
    { id: "at", label: "At", type: "text" },
    { id: "span", label: "Span", type: "text" },
  ],
  rows: [
    {
      cells: {
        name: "Alice",
        qty: 30,
        rate: 1.5,
        active: true,
        amount: 19.99,
        day: "2024-06-01",
        updated: "2024-06-01 14:30:00",
        at: "14:30:00",
        span: "P1DT2H",
      },
    },
    {
      cells: {
        name: "Bob",
        qty: 25,
        rate: 2.75,
        active: false,
        amount: 9.5,
        day: "2025-01-15",
        updated: "2025-01-15T09:00:00",
        at: "09:00:00",
        span: "PT30M",
      },
    },
  ],
});

/**
 * @typedef {{ outputType: string, locked: boolean }} ColumnTypeConfig
 */

/**
 * @param {string | number | boolean | null | undefined} value
 * @param {import("./convert/model.js").ColumnType} type
 */
function formatOutputCell(value, type) {
  if (value === null || value === undefined) return "";
  if (type === "logical") return value ? "TRUE" : "FALSE";
  return String(value);
}

/**
 * @param {HTMLElement | null} blockEl
 * @param {import("./convert/model.js").TableModel} table
 * @param {ReturnType<typeof initTable> | null} previous
 */
function renderOutputTable(blockEl, table, previous) {
  previous?.destroy();
  if (!blockEl) return null;

  const tableEl = blockEl.querySelector("table.table");
  const theadRow = tableEl?.querySelector("thead tr");
  const tbody = tableEl?.querySelector("tbody");
  if (!tableEl || !theadRow || !tbody) return null;

  theadRow.replaceChildren();
  tbody.replaceChildren();

  const { columns, rows } = table;
  const canSort = columns.length > 0 && rows.length > 0;

  if (columns.length === 0) {
    const empty = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 1;
    cell.className = "table-empty";
    cell.textContent = "No columns";
    empty.append(cell);
    tbody.append(empty);
    return initTable(blockEl, { sortable: false });
  }

  for (const col of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    if (col.type === "number") th.className = "table-num";

    if (canSort) {
      th.dataset.tableSort = "";
      th.dataset.sortType = col.type === "number" ? "number" : "text";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-sort-button";
      button.textContent = col.label || col.id;
      th.append(button);
    } else {
      th.textContent = col.label || col.id;
    }
    theadRow.append(th);
  }

  if (rows.length === 0) {
    const empty = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.className = "table-empty";
    cell.textContent = "No rows";
    empty.append(cell);
    tbody.append(empty);
    return initTable(blockEl, { sortable: false });
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.id) tr.dataset.tableRowId = row.id;
    for (const col of columns) {
      const td = document.createElement("td");
      if (col.type === "number") td.className = "table-num";
      td.textContent = formatOutputCell(row.cells?.[col.id], col.type);
      tr.append(td);
    }
    tbody.append(tr);
  }

  return initTable(blockEl, { sortable: true });
}

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
  const outputTableEl = root.querySelector("#output-table");
  const configSection = root.querySelector("#config-section");
  const configColumnsEl = root.querySelector("#config-columns");

  /** @type {import("./convert/model.js").TableModel} */
  let model = SAMPLE;

  let source = "tabular";
  let target = "dax";
  let daxDialect = "datatable";
  let mDialect = "table";
  let alignCommas = false;
  let minimised = false;
  let commaFirst = false;
  let syncing = false;
  let convertGen = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounceTimer;
  /** @type {ReturnType<typeof initTable> | null} */
  let outputTable = null;

  /** @type {Map<string, ColumnTypeConfig>} */
  const typeConfig = new Map();

  const inputTabular = initTabularInput(root.querySelector("#input-tabular"), {
    columns: model.columns,
    rows: model.rows,
    onChange({ columns, rows, source: changeSource }) {
      if (syncing || source !== "tabular") return;
      if (changeSource === "init") return;
      model = normalizeTable({ columns, rows });
      syncTypeConfigFromModel({ remappingLang: null });
      renderConfigUi();
      scheduleConvert();
    },
  });

  const inputCode = initCodeBlock(root.querySelector("#input-code"), {
    mode: "edit",
  });

  const outputCode = initCodeBlock(root.querySelector("#output-code"), {
    mode: "select",
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

  initToggle(root.querySelector("#align-commas-toggle"), {
    defaultChecked: false,
    onChange({ checked, source: changeSource }) {
      if (changeSource === "init") return;
      alignCommas = checked;
      void runConvert();
    },
  });

  initToggle(root.querySelector("#minimised-output-toggle"), {
    defaultChecked: false,
    onChange({ checked, source: changeSource }) {
      if (changeSource === "init") return;
      minimised = checked;
      void runConvert();
    },
  });

  initToggle(root.querySelector("#comma-first-toggle"), {
    defaultChecked: false,
    onChange({ checked, source: changeSource }) {
      if (changeSource === "init") return;
      commaFirst = checked;
      void runConvert();
    },
  });

  /** @returns {{ alignCommas: boolean, minimised: boolean, commaFirst: boolean }} */
  function generateOptions() {
    return { alignCommas, minimised, commaFirst };
  }

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

  /** @returns {"dax" | "m" | null} */
  function configLang() {
    if (source !== "tabular") return null;
    if (target === "dax" || target === "m") return target;
    return null;
  }

  function configVisible() {
    return configLang() !== null;
  }

  /**
   * @param {import("./convert/model.js").Column} col
   * @param {"dax" | "m"} lang
   */
  function columnValues(col) {
    return model.rows.map((row) => row.cells[col.id]);
  }

  /**
   * Keep typeConfig in sync with model columns. Unlocked columns are re-suggested.
   * @param {{ remappingLang?: { from: "dax" | "m", to: "dax" | "m" } | null }} [opts]
   */
  function syncTypeConfigFromModel({ remappingLang = null } = {}) {
    const lang = configLang();
    if (!lang) return;

    const nextIds = new Set(model.columns.map((col) => col.id));
    for (const id of [...typeConfig.keys()]) {
      if (!nextIds.has(id)) typeConfig.delete(id);
    }

    for (const col of model.columns) {
      const existing = typeConfig.get(col.id);
      const suggested = suggestOutputType(lang, col.type, columnValues(col));

      if (!existing) {
        typeConfig.set(col.id, { outputType: suggested, locked: false });
        continue;
      }

      if (remappingLang && existing.locked) {
        const remapped = remapOutputType(
          remappingLang.from,
          remappingLang.to,
          existing.outputType
        );
        if (remapped) {
          typeConfig.set(col.id, { outputType: remapped, locked: true });
        } else {
          typeConfig.set(col.id, { outputType: suggested, locked: false });
        }
        continue;
      }

      if (existing.locked) {
        if (!isValidOutputType(lang, existing.outputType)) {
          typeConfig.set(col.id, { outputType: suggested, locked: false });
        }
        continue;
      }

      typeConfig.set(col.id, { outputType: suggested, locked: false });
    }
  }

  /**
   * Attach configured outputType onto a copy of the model for generation.
   * @param {import("./convert/model.js").TableModel} table
   * @param {"dax" | "m"} lang
   */
  function modelWithOutputTypes(table, lang) {
    return normalizeTable({
      columns: table.columns.map((col) => {
        const cfg = typeConfig.get(col.id);
        const outputType =
          cfg?.outputType && isValidOutputType(lang, cfg.outputType)
            ? cfg.outputType
            : suggestOutputType(lang, col.type, table.rows.map((r) => r.cells[col.id]));
        return { ...col, outputType };
      }),
      rows: table.rows,
    });
  }

  function renderConfigUi() {
    if (!configColumnsEl) return;

    const lang = configLang();
    if (!lang) {
      configColumnsEl.replaceChildren();
      return;
    }

    const options = outputTypeOptions(lang);

    if (model.columns.length === 0) {
      const empty = document.createElement("p");
      empty.className = "converter-config-empty";
      empty.textContent = "Add columns in the input table to configure types.";
      configColumnsEl.replaceChildren(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    for (const col of model.columns) {
      const cfg = typeConfig.get(col.id) ?? {
        outputType: suggestOutputType(lang, col.type, columnValues(col)),
        locked: false,
      };
      if (!typeConfig.has(col.id)) typeConfig.set(col.id, cfg);

      const cell = document.createElement("div");
      cell.className = "converter-config-cell";
      cell.setAttribute("role", "listitem");

      const head = document.createElement("div");
      head.className = "converter-config-cell-head";

      const name = document.createElement("span");
      name.className = "converter-config-name";
      name.textContent = col.label || col.id;
      name.title = col.label || col.id;

      const lock = document.createElement(cfg.locked ? "button" : "span");
      lock.className = "converter-config-lock";
      lock.dataset.locked = cfg.locked ? "true" : "false";
      lock.textContent = cfg.locked ? "Locked" : "Auto";

      if (cfg.locked) {
        lock.type = "button";
        lock.dataset.tooltip = "Click for auto-detect";
        lock.dataset.tooltipPosition = "top";
        lock.setAttribute(
          "aria-label",
          `Unlock output type for ${col.label || col.id}`
        );
        lock.addEventListener("click", () => {
          const suggested = suggestOutputType(
            lang,
            col.type,
            columnValues(col)
          );
          typeConfig.set(col.id, {
            outputType: suggested,
            locked: false,
          });
          renderConfigUi();
          void runConvert();
        });
      }

      head.append(name, lock);

      const select = document.createElement("select");
      select.className = "input converter-config-type";
      select.dataset.columnId = col.id;
      select.setAttribute(
        "aria-label",
        `Output type for ${col.label || col.id}`
      );

      for (const opt of options) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === cfg.outputType) option.selected = true;
        select.append(option);
      }

      if (!options.some((opt) => opt.value === cfg.outputType)) {
        const option = document.createElement("option");
        option.value = cfg.outputType;
        option.textContent = cfg.outputType;
        option.selected = true;
        select.append(option);
      }

      select.addEventListener("change", () => {
        typeConfig.set(col.id, {
          outputType: select.value,
          locked: true,
        });
        renderConfigUi();
        void runConvert();
      });

      cell.append(head, select);
      frag.append(cell);
    }

    configColumnsEl.replaceChildren(frag);
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
    setHidden(configSection, !configVisible());

    const inputLang = prismLanguage(source);
    if (inputLang) inputCode?.setLanguage(inputLang);
    const outputLang = prismLanguage(target);
    if (outputLang) outputCode?.setLanguage(outputLang);
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

    syncTypeConfigFromModel();
    updateDialectVisibility();
    updatePaneVisibility();
    renderConfigUi();

    syncing = true;
    try {
      if (source === "tabular") {
        inputTabular?.setData(model, { emitEvent: false });
      } else {
        const dialect = source === "dax" ? daxDialect : mDialect;
        const code = await generate(source, dialect, model, generateOptions());
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

    const previousTarget = target;
    target = next;
    if (target === source) {
      source = fallbackLang(target);
      syncing = true;
      sourceControl?.selectValue(source, { emit: false });
      try {
        if (source === "tabular") {
          inputTabular?.setData(model, { emitEvent: false });
        } else {
          const dialect = source === "dax" ? daxDialect : mDialect;
          const code = await generate(source, dialect, model, generateOptions());
          inputCode?.setSource(String(await code));
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
      syncing = false;
    }

    const from =
      previousTarget === "dax" || previousTarget === "m" ? previousTarget : null;
    const to = target === "dax" || target === "m" ? target : null;
    if (from && to && from !== to) {
      syncTypeConfigFromModel({ remappingLang: { from, to } });
    } else {
      syncTypeConfigFromModel();
    }

    updateDialectVisibility();
    updatePaneVisibility();
    renderConfigUi();
    await runConvert();
  }

  async function runConvert() {
    const gen = ++convertGen;

    try {
      if (source === "tabular") {
        model = normalizeTable(inputTabular?.getData() ?? model);
        syncTypeConfigFromModel();
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
        outputTable = renderOutputTable(outputTableEl, model, outputTable);
      } else if (target === "dax" || target === "m") {
        const dialect = target === "dax" ? daxDialect : mDialect;
        const typed =
          source === "tabular" ? modelWithOutputTypes(model, target) : model;
        const code = await generate(target, dialect, typed, generateOptions());
        if (gen !== convertGen) return;
        outputCode?.setSource(String(await code));
      }
      syncing = false;
      clearError();
      if (source === "tabular") renderConfigUi();
    } catch (err) {
      syncing = false;
      if (gen !== convertGen) return;
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  syncTypeConfigFromModel();
  // CURRENCY is not auto-detected; lock Amount in the starter sample for DAX.
  if (configLang() === "dax" && typeConfig.has("amount")) {
    typeConfig.set("amount", { outputType: "CURRENCY", locked: true });
  }
  updateDialectVisibility();
  updatePaneVisibility();
  renderConfigUi();
  void runConvert();

  return {
    getModel: () => model,
    refresh: () => runConvert(),
  };
}
