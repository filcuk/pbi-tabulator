/**
 * Converter app: source/target switches, dialect pickers, live conversion.
 */

import { setHidden } from "./utils/dom.js";
import {
  flashButtonLabel,
  prepareButtonLabelFlash,
  setButtonLabelFlash,
} from "./utils/button-label.js";
import { initSegmentedControl } from "./components/segmented-control.js";
import { initDropdown } from "./components/dropdown.js";
import {
  formatClipboardTable,
  initTabularInput,
} from "./components/tabular-input.js";
import { initTable } from "./components/table.js";
import { initCodeBlock } from "./components/code-block.js";
import { initExpandableSurface } from "./components/expandable-surface.js";
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
 * Copy text to the clipboard (Clipboard API, with execCommand fallback).
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "none";
  textarea.style.outline = "none";
  textarea.style.boxShadow = "none";
  textarea.style.background = "transparent";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

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

/**
 * Code-block language is fixed at init. Remount when DAX vs M highlighting changes.
 * @param {HTMLElement | null} el
 * @param {Parameters<typeof initCodeBlock>[1]} options
 * @param {{ onReady?: (el: HTMLElement) => void, onBeforeRemount?: (el: HTMLElement) => void }} [hooks]
 */
function initConverterCodeBlock(el, options, hooks = {}) {
  if (!(el instanceof HTMLElement)) return null;

  /** @type {ReturnType<typeof initCodeBlock> | null} */
  let instance = null;
  /** @type {ReturnType<typeof initExpandableSurface> | null} */
  let expandInstance = null;

  function bind() {
    instance = initCodeBlock(el, options);
    expandInstance?.destroy();
    expandInstance = el.hasAttribute("data-expandable-surface")
      ? initExpandableSurface(el)
      : null;
    hooks.onReady?.(el);
  }

  bind();

  return {
    getSource() {
      return instance?.getSource() ?? "";
    },
    setSource(next) {
      instance?.setSource(next);
    },
    /**
     * @param {string} language
     */
    setLanguage(language) {
      const current = el
        .querySelector("code")
        ?.className.match(/language-([\w-]+)/)?.[1];
      if (!language || current === language) return;

      const source = instance?.getSource() ?? "";
      const mode = instance?.getMode() ?? options.mode;
      hooks.onBeforeRemount?.(el);
      expandInstance?.destroy();
      expandInstance = null;
      delete el.dataset.codeBlockInit;
      el.replaceChildren();

      const body = document.createElement("div");
      body.className = "code-block-body";
      if (el.hasAttribute("data-expandable-surface")) {
        body.setAttribute("data-expandable-surface-trigger", "");
      }
      const pre = document.createElement("pre");
      pre.className = `line-numbers language-${language}`;
      const code = document.createElement("code");
      code.className = `language-${language}`;
      pre.append(code);
      body.append(pre);
      el.append(body);

      bind();
      instance?.setMode(mode);
      instance?.setSource(source);
    },
  };
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
        updated: "2025-01-15 09:00:00",
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
  const configHint = root.querySelector(".converter-config-hint");
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
  /** @type {Array<ReturnType<typeof initDropdown>>} */
  let configDropdowns = [];

  function destroyConfigDropdowns() {
    for (const dropdown of configDropdowns) dropdown?.destroy?.();
    configDropdowns = [];
  }

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

  const inputCodeEl = root.querySelector("#input-code");
  const inputCode = initConverterCodeBlock(inputCodeEl, {
    mode: "edit",
    toolbar: "top",
    toolbarActions: ["clear", "copy", "paste", "maximize"],
    surfaceActions: "none",
  });

  const outputCodeEl = root.querySelector("#output-code");
  const outputCodeExtras = root.querySelector("#output-code-extras");

  function parkOutputCodeExtras() {
    if (!(outputCodeExtras instanceof HTMLElement) || !outputCodeWrap) return;
    outputCodeWrap.append(outputCodeExtras);
    setHidden(outputCodeExtras, true);
  }

  function attachOutputCodeExtras() {
    const left = outputCodeEl?.querySelector(
      ".code-block-toolbar__group--left"
    );
    if (!(outputCodeExtras instanceof HTMLElement) || !left) return;
    left.append(outputCodeExtras);
    setHidden(outputCodeExtras, false);
  }

  const outputCode = initConverterCodeBlock(
    outputCodeEl,
    {
      mode: "select",
      toolbar: "top",
      toolbarActions: ["copy", "maximize"],
      surfaceActions: "none",
    },
    {
      onBeforeRemount: parkOutputCodeExtras,
      onReady: attachOutputCodeExtras,
    }
  );

  const outputTabularCopyBtn = root.querySelector("#output-tabular-copy");
  if (outputTabularCopyBtn instanceof HTMLButtonElement) {
    prepareButtonLabelFlash(outputTabularCopyBtn, { idle: "Copy" });
  }

  /** @type {MutationObserver | null} */
  let inputPasteSourceObserver = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let inputPasteSourceTimer = null;

  function stopWatchingInputPaste() {
    inputPasteSourceObserver?.disconnect();
    inputPasteSourceObserver = null;
    if (inputPasteSourceTimer !== null) {
      clearTimeout(inputPasteSourceTimer);
      inputPasteSourceTimer = null;
    }
  }

  /**
   * Toolbar clear/paste do not fire `input` on the editor. Convert after those
   * actions so the output stays in sync.
   */
  inputCodeEl?.addEventListener("click", (event) => {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const btn = origin.closest("[data-code-toolbar-action]");
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return;
    const action = btn.dataset.codeToolbarAction;
    if (action === "clear") {
      stopWatchingInputPaste();
      scheduleConvert();
      return;
    }
    if (action !== "paste") return;

    const codeEl = inputCodeEl.querySelector("code");
    if (!(codeEl instanceof HTMLElement)) return;

    stopWatchingInputPaste();
    inputPasteSourceObserver = new MutationObserver(() => {
      stopWatchingInputPaste();
      if (syncing || (source !== "dax" && source !== "m")) return;
      scheduleConvert();
    });
    inputPasteSourceObserver.observe(codeEl, {
      attributes: true,
      attributeFilter: ["data-source"],
    });
    inputPasteSourceTimer = setTimeout(stopWatchingInputPaste, 16000);
  });

  outputTabularCopyBtn?.addEventListener("click", async () => {
    if (!(outputTabularCopyBtn instanceof HTMLButtonElement)) return;
    const text = formatClipboardTable(model.columns, model.rows);
    const ok = await copyTextToClipboard(text);
    flashButtonLabel(outputTabularCopyBtn, ok, {
      reset: () => {
        setButtonLabelFlash(outputTabularCopyBtn, "Copy");
        outputTabularCopyBtn.setAttribute("aria-label", "Copy table");
      },
    });
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
      updatePaneVisibility();
      renderConfigUi();
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
    return typesConfigVisible();
  }

  /** Column output types apply to DAX and typed M dialects (#table / Binary.FromText), not FromRecords. */
  function typesConfigVisible() {
    const lang = configLang();
    if (!lang) return false;
    if (lang === "m" && mDialect === "from-records") return false;
    return true;
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

  /**
   * @param {import("./convert/model.js").Column} col
   * @param {ColumnTypeConfig} cfg
   * @param {readonly import("./convert/output-types.js").OutputTypeOption[]} options
   */
  function createTypeDropdown(col, cfg, options) {
    const selected =
      options.find((opt) => opt.value === cfg.outputType) ?? {
        value: cfg.outputType,
        label: cfg.outputType,
      };
    const menuOptions = options.some((opt) => opt.value === selected.value)
      ? options
      : [...options, selected];
    const menuId = `converter-config-type-menu-${col.id}`;

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown converter-config-type";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "btn dropdown-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menuId);
    trigger.setAttribute(
      "aria-label",
      `Output type for ${col.label || col.id}`
    );

    const triggerLabel = document.createElement("span");
    triggerLabel.className = "dropdown-trigger-label";
    triggerLabel.textContent = selected.label;

    const chevron = document.createElement("span");
    chevron.className = "combo-btn-chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(triggerLabel, chevron);

    const menu = document.createElement("ul");
    menu.id = menuId;
    menu.className = "dropdown-menu hidden";
    menu.setAttribute("role", "menu");
    setHidden(menu, true);

    for (const opt of menuOptions) {
      const li = document.createElement("li");
      li.setAttribute("role", "none");
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dropdown-menu-item";
      item.setAttribute("role", "menuitem");
      item.dataset.value = opt.value;
      item.textContent = opt.label;
      if (opt.value === selected.value) item.classList.add("is-selected");
      li.append(item);
      menu.append(li);
    }

    dropdown.append(trigger, menu);

    const api = initDropdown(dropdown, {
      onSelect({ value }) {
        if (!value) return;
        const prev = typeConfig.get(col.id);
        if (prev?.outputType === value && prev.locked) return;
        typeConfig.set(col.id, { outputType: value, locked: true });
        renderConfigUi();
        void runConvert();
      },
    });
    if (api) configDropdowns.push(api);

    return dropdown;
  }

  function renderConfigUi() {
    if (!configColumnsEl) return;

    destroyConfigDropdowns();

    const lang = configLang();
    if (!lang || !typesConfigVisible()) {
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
      cell.append(head, createTypeDropdown(col, cfg, options));
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
    const showTypes = typesConfigVisible();
    setHidden(inputTabularWrap, !sourceIsTable);
    setHidden(inputCodeWrap, sourceIsTable);
    setHidden(outputTabularWrap, !targetIsTable);
    setHidden(outputCodeWrap, targetIsTable);
    setHidden(configSection, !configVisible());
    setHidden(configColumnsEl, !showTypes);
    if (configHint) {
      configHint.textContent = "Configure column types.";
    }

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
    } catch {
      // Keep the last good model so the user can leave invalid code.
    }

    clearError();
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
          source === "tabular" && typesConfigVisible()
            ? modelWithOutputTypes(model, target)
            : model;
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
