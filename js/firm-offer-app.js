import { getRuntimeConfig, subscribeToRuntimeCustomization, syncRuntimeCustomizationFromServer } from '../shared/config.js';
import {
  buildEmailText,
  buildHtmlEmailDocument,
  buildMailtoUrl,
  buildVesselSpecsBlocks,
  getTermBehavior,
  trimmed
} from '../shared/offer-logic.js';
import {
  getSharedState,
  replaceSharedState,
  subscribeToSharedState
} from '../shared/store.js';

const APP_SOURCE = `firm-offer-app:${Math.random().toString(36).slice(2)}`;
const THEME_STORAGE_KEY = 'coreShippingTheme';
const LEGACY_THEME_STORAGE_KEY = 'firmOfferGeneratorTheme';
const LEGACY_APPLICABLE_CONTRACT_TEXT = 'Clean Gencon 94 to apply';
const UPDATED_APPLICABLE_CONTRACT_TEXT = 'Carriers BN';
const CUSTOMIZATION_SIGNATURE_KEY = 'coreShippingCustomizationSignatureV1';

let runtimeConfig = getRuntimeConfig();

const form = document.getElementById('offerForm');
const subjectPreview = document.getElementById('subjectPreview');
const emailPreview = document.getElementById('emailPreview');
const toPreview = document.getElementById('toPreview');
const ccPreview = document.getElementById('ccPreview');
const statusEl = document.getElementById('status');
const laytimeFields = document.getElementById('laytimeFields');
const fltFields = document.getElementById('fltFields');
const congestionRow = document.getElementById('congestionRow');
const congestionToggleLabel = document.getElementById('congestionToggleLabel');
const loadingTextLabel = document.getElementById('loadingTextLabel');
const dischargingTextLabel = document.getElementById('dischargingTextLabel');
const termMeaningNote = document.getElementById('termMeaningNote');
const termStructureNote = document.getElementById('termStructureNote');
const loadingDaysField = document.getElementById('loadingDaysField');
const loadingTermsField = document.getElementById('loadingTermsField');
const dischargingDaysField = document.getElementById('dischargingDaysField');
const dischargingTermsField = document.getElementById('dischargingTermsField');
const fltLoadingField = document.getElementById('fltLoadingField');
const fltDischargingField = document.getElementById('fltDischargingField');
const vesselSelect = document.getElementById('vessel');
const includeVesselSpecsInput = document.getElementById('includeVesselSpecs');
const vesselSpecsField = document.getElementById('vesselSpecs');
const vesselSpecsHtmlField = document.getElementById('vesselSpecsHtml');
const vesselSpecsPreview = document.getElementById('vesselSpecsPreview');
const htmlPreviewFrame = document.getElementById('htmlPreviewFrame');
const cargoOfferInput = document.getElementById('cargoOfferInput');
const cargoOfferStatus = document.getElementById('cargoOfferStatus');

const fieldElements = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]'));
const fieldNames = fieldElements.map((element) => element.name);

let currentView = 'raw';
let isApplyingExternalState = false;
let lastSharedStateSignature = '';

function currentDefaults() {
  return runtimeConfig.formDefaults || {};
}

function fillSelect(id, options, selectedValue) {
  const select = document.getElementById(id);
  if (!select) return;

  const safeOptions = Array.isArray(options) && options.length ? options : [selectedValue || ''];
  const finalSelected = safeOptions.includes(selectedValue) ? selectedValue : safeOptions[0] || '';

  select.innerHTML = '';
  safeOptions.forEach((option) => {
    const el = document.createElement('option');
    el.value = option;
    el.textContent = option;
    if (option === finalSelected) el.selected = true;
    select.appendChild(el);
  });
}

function initializeSelects(preferredValues = {}) {
  const defaults = currentDefaults();
  fillSelect('vessel', runtimeConfig.vesselOptions, preferredValues.vessel || defaults.vessel);
  fillSelect('underDeck', runtimeConfig.underDeckOptions, preferredValues.underDeck || defaults.underDeck);
  fillSelect('cargoStackable', runtimeConfig.cargoStackableOptions, preferredValues.cargoStackable || defaults.cargoStackable);
  fillSelect('currency', runtimeConfig.currencyOptions, preferredValues.currency || defaults.currency);
  fillSelect('freightTerms', runtimeConfig.freightTermsOptions, preferredValues.freightTerms || defaults.freightTerms);
  fillSelect('terms', runtimeConfig.termsOptions, preferredValues.terms || defaults.terms);
  fillSelect('loadingTerms', runtimeConfig.laytimeTermsOptions, preferredValues.loadingTerms || defaults.loadingTerms);
  fillSelect('dischargingTerms', runtimeConfig.laytimeTermsOptions, preferredValues.dischargingTerms || defaults.dischargingTerms);
  fillSelect('agentLoad', runtimeConfig.agentOptions, preferredValues.agentLoad || defaults.agentLoad);
  fillSelect('agentDischarge', runtimeConfig.agentOptions, preferredValues.agentDischarge || defaults.agentDischarge);
}

function applyTextDefaults(preferredValues = {}) {
  const defaults = { ...currentDefaults(), ...preferredValues };

  fieldElements.forEach((element) => {
    if (!element.name || element.tagName === 'SELECT') return;
    if (!(element.name in defaults)) return;

    if (element.type === 'checkbox') {
      element.checked = Boolean(defaults[element.name]);
    } else {
      element.value = String(defaults[element.name] ?? '');
    }
  });
}

function getFieldElement(name) {
  return form.elements.namedItem(name);
}

function collectFormData() {
  const data = Object.fromEntries(new FormData(form).entries());

  fieldElements.forEach((element) => {
    if (element.type === 'checkbox') {
      data[element.name] = element.checked;
    } else if (!(element.name in data)) {
      data[element.name] = element.value;
    }
  });

  return data;
}

function migrateLegacyFormState(snapshot) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const migrated = { ...safeSnapshot };

  if (trimmed(migrated.applicableContract) === LEGACY_APPLICABLE_CONTRACT_TEXT) {
    migrated.applicableContract = UPDATED_APPLICABLE_CONTRACT_TEXT;
  }

  const legacySuffix = trimmed(migrated.terminalSuffix);
  if (!trimmed(migrated.polSuffix) && legacySuffix) {
    migrated.polSuffix = legacySuffix;
  }
  if (!trimmed(migrated.podSuffix) && legacySuffix) {
    migrated.podSuffix = legacySuffix;
  }

  return migrated;
}

function syncStructuredVesselSpecs() {
  if (!vesselSpecsField || !vesselSelect) return;

  const generatedBlocks = buildVesselSpecsBlocks(vesselSelect.value, runtimeConfig);
  vesselSpecsField.value = generatedBlocks.raw;
  if (vesselSpecsHtmlField) {
    vesselSpecsHtmlField.value = generatedBlocks.html;
  }
  includeVesselSpecsInput.checked = Boolean(trimmed(generatedBlocks.raw));

  if (vesselSpecsPreview) {
    vesselSpecsPreview.textContent = generatedBlocks.raw || 'No enabled structured spec rows for the selected vessel.';
  }
}

function applySnapshotToForm(snapshot) {
  isApplyingExternalState = true;

  try {
    fieldNames.forEach((name) => {
      const element = getFieldElement(name);
      if (!element || !(name in snapshot)) return;

      if (element.tagName === 'SELECT') return;

      if (element.type === 'checkbox') {
        element.checked = Boolean(snapshot[name]);
      } else {
        element.value = String(snapshot[name] ?? '');
      }
    });

    initializeSelects(snapshot);
    syncStructuredVesselSpecs();
  } finally {
    isApplyingExternalState = false;
  }
}

function updateConditionalUI() {
  const selectedTerm = document.getElementById('terms').value;
  const behavior = getTermBehavior(selectedTerm);
  const isTextMode = behavior.mode === 'text';
  const includeLoading = behavior.includeLoading !== false;
  const includeDischarging = behavior.includeDischarging !== false;

  laytimeFields.classList.toggle('hidden', isTextMode);
  fltFields.classList.toggle('hidden', !isTextMode);
  congestionRow.classList.toggle('hidden', !isTextMode);
  if (loadingDaysField) loadingDaysField.classList.toggle('hidden', !includeLoading);
  if (loadingTermsField) loadingTermsField.classList.toggle('hidden', !includeLoading);
  if (dischargingDaysField) dischargingDaysField.classList.toggle('hidden', !includeDischarging);
  if (dischargingTermsField) dischargingTermsField.classList.toggle('hidden', !includeDischarging);
  if (fltLoadingField) fltLoadingField.classList.toggle('hidden', !includeLoading);
  if (fltDischargingField) fltDischargingField.classList.toggle('hidden', !includeDischarging);

  if (congestionToggleLabel) {
    congestionToggleLabel.textContent = `Include congestion clause when ${selectedTerm} is selected`;
  }

  const loadingDaysLabel = document.querySelector('label[for="loadingDays"]');
  const dischargingDaysLabel = document.querySelector('label[for="dischargingDays"]');

  if (loadingTextLabel) {
    loadingTextLabel.textContent = `${selectedTerm} loading text`;
  }

  if (dischargingTextLabel) {
    dischargingTextLabel.textContent = `${selectedTerm} discharging text`;
  }

  if (loadingDaysLabel) {
    loadingDaysLabel.textContent = `${selectedTerm} loading days`;
  }

  if (dischargingDaysLabel) {
    dischargingDaysLabel.textContent = `${selectedTerm} discharging days`;
  }

  if (termMeaningNote) {
    termMeaningNote.textContent = behavior.meaning;
  }

  if (termStructureNote) {
    termStructureNote.textContent = behavior.structure;
  }
}

function buildHtmlPreviewDocument() {
  const html = buildHtmlEmailDocument(collectFormData());
  const isDarkTheme = document.body.getAttribute('data-theme') === 'dark';
  const previewCanvas = isDarkTheme ? '#101926' : '#eef3f7';
  const previewText = isDarkTheme ? '#dbe6f3' : '#17314f';
  const previewEdge = isDarkTheme ? '#31445d' : '#d7e0eb';

  const previewStyle = `
        <style>
          :root {
            color-scheme: ${isDarkTheme ? 'dark' : 'light'};
          }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            min-height: 100% !important;
            overflow-x: hidden !important;
            background: ${previewCanvas} !important;
            color: ${previewText} !important;
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
          }

          html::-webkit-scrollbar,
          body::-webkit-scrollbar {
            width: 0 !important;
            height: 0 !important;
            display: none !important;
          }

          body {
            font-family: Arial, Helvetica, sans-serif !important;
            -webkit-font-smoothing: antialiased !important;
          }

          table {
            max-width: 100% !important;
          }

          table[width="760"] {
            width: min(760px, calc(100vw - 24px)) !important;
            max-width: min(760px, calc(100vw - 24px)) !important;
            box-shadow: 0 14px 30px rgba(15, 23, 36, ${isDarkTheme ? 0.34 : 0.10}) !important;
          }

          td {
            box-sizing: border-box !important;
            word-break: break-word !important;
          }

          img {
            max-width: 100% !important;
            height: auto !important;
          }

          body > table[role="presentation"] {
            background: ${previewCanvas} !important;
          }

          body > table[role="presentation"] > tbody > tr > td > table[role="presentation"] {
            border-color: ${previewEdge} !important;
          }
        </style>
      `;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${previewStyle}</head>`);
  }

  return html.replace(/<body/i, `<head>${previewStyle}</head><body`);
}

async function copyHtmlForRichPaste(htmlDocument) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(htmlDocument, 'text/html');
  const htmlFragment = parsed.body?.innerHTML || htmlDocument;
  const plainText = parsed.body?.innerText || '';

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const item = new ClipboardItem({
      'text/html': new Blob([htmlFragment], { type: 'text/html' }),
      'text/plain': new Blob([plainText], { type: 'text/plain' })
    });
    await navigator.clipboard.write([item]);
    return true;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(htmlFragment);
    return false;
  }

  return false;
}

function refreshHtmlPreview() {
  htmlPreviewFrame.setAttribute('scrolling', 'yes');
  htmlPreviewFrame.srcdoc = buildHtmlPreviewDocument();
}

function refreshPreview() {
  updateConditionalUI();
  syncStructuredVesselSpecs();

  const data = collectFormData();
  const emailText = buildEmailText(data);

  subjectPreview.textContent = emailText.subject;
  toPreview.textContent = trimmed(data.emailTo) || '—';
  ccPreview.textContent = trimmed(data.emailCc) || '—';
  emailPreview.textContent = emailText.body;

  if (!htmlPreviewFrame.classList.contains('hidden')) {
    refreshHtmlPreview();
  }
}

function setCargoOfferStatus(message) {
  if (!cargoOfferStatus) return;
  cargoOfferStatus.textContent = message;
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toTitleCase(value) {
  return normalizeSpaces(value)
    .toLowerCase()
    .split(' ')
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : '')
    .join(' ');
}

function extractRoute(lines) {
  for (const line of lines) {
    const match = line.match(/\b([A-Z][A-Z\s.-]{2,})\s*\/\s*([A-Z][A-Z\s.-]{2,})\b/);
    if (!match) continue;
    return {
      pol: toTitleCase(match[1]),
      pod: toTitleCase(match[2])
    };
  }
  return { pol: '', pod: '' };
}

function extractRates(lines) {
  for (const line of lines) {
    const match = line.match(/\b(\d{3,5})\s*\/\s*(\d{3,5})\b/);
    if (!match) continue;
    const loadRate = Number(match[1]);
    const dischargeRate = Number(match[2]);
    if (!Number.isFinite(loadRate) || !Number.isFinite(dischargeRate)) continue;
    return { loadRate, dischargeRate };
  }
  return { loadRate: 0, dischargeRate: 0 };
}

function formatDays(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function parseCargoOfferEmail(text) {
  const raw = String(text || '');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const uppercaseLines = lines.map((line) => line.toUpperCase());

  const route = extractRoute(uppercaseLines);
  const rates = extractRates(uppercaseLines);

  const cargoLine = uppercaseLines.find((line) => /\bMT\b/.test(line) && /\bCEMENT\b/.test(line)) || '';
  const laycanLine = uppercaseLines.find((line) => /\bSPOT\b/.test(line) || /\bLAYCAN\b/.test(line)) || '';

  const commissionMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const commission = commissionMatch ? commissionMatch[1].replace(',', '.') : '';

  const accountLine = lines.find((line) => /agency/i.test(line) || /charterer/i.test(line) || /broker/i.test(line)) || '';
  const quantityMatch = cargoLine.match(/(\d{3,6}\s*-\s*\d{3,6}\s*MT[^,\n]*)/i);
  const cargo = normalizeSpaces(quantityMatch ? quantityMatch[1] : cargoLine);

  const maxQtyMatch = cargoLine.match(/(\d{3,6})\s*-\s*(\d{3,6})\s*MT/i);
  const maxQty = maxQtyMatch ? Number(maxQtyMatch[2]) : 0;

  const loadingDays = maxQty && rates.loadRate ? formatDays(maxQty / rates.loadRate) : '';
  const dischargingDays = maxQty && rates.dischargeRate ? formatDays(maxQty / rates.dischargeRate) : '';

  return {
    account: accountLine,
    cargo,
    laycanDate: normalizeSpaces(laycanLine),
    pol: route.pol,
    pod: route.pod,
    commissionPercentage: commission,
    loadingDays,
    dischargingDays
  };
}

function applyCargoOfferAutofill() {
  const input = cargoOfferInput?.value || '';
  if (!trimmed(input)) {
    setCargoOfferStatus('Paste a cargo offer email first.');
    return;
  }

  const parsed = parseCargoOfferEmail(input);
  const updates = [
    ['account', parsed.account],
    ['cargo', parsed.cargo],
    ['laycanDate', parsed.laycanDate],
    ['pol', parsed.pol],
    ['pod', parsed.pod],
    ['commissionPercentage', parsed.commissionPercentage],
    ['loadingDays', parsed.loadingDays],
    ['dischargingDays', parsed.dischargingDays]
  ];

  let changedCount = 0;
  updates.forEach(([name, value]) => {
    if (!trimmed(value)) return;
    const field = getFieldElement(name);
    if (!field) return;
    field.value = value;
    changedCount += 1;
  });

  if (!changedCount) {
    setCargoOfferStatus('No supported fields were detected from the pasted email.');
    return;
  }

  pushWholeFormToStore();
  refreshPreview();
  setCargoOfferStatus(`Auto-fill updated ${changedCount} field${changedCount === 1 ? '' : 's'}. Please verify freight and dem/det manually.`);
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    if (statusEl.textContent === message) statusEl.textContent = '';
  }, 2600);
}

function refreshThemeSensitiveUI() {
  refreshPreview();

  const rawPreview = document.getElementById('emailPreview');
  const resolvedColor = getComputedStyle(rawPreview).color;
  rawPreview.style.webkitTextFillColor = resolvedColor;

  if (currentView === 'html') {
    requestAnimationFrame(() => refreshHtmlPreview());
  }
}

function applyTheme(theme) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', normalizedTheme);
  document.documentElement.setAttribute('data-theme', normalizedTheme);
}

function initializeTheme() {
  let savedTheme = null;

  try {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (_) {}

  if (savedTheme === 'dark' || savedTheme === 'light') {
    applyTheme(savedTheme);
    refreshThemeSensitiveUI();
    return;
  }

  try {
    const legacyTheme = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacyTheme === 'dark' || legacyTheme === 'light') {
      localStorage.setItem(THEME_STORAGE_KEY, legacyTheme);
      applyTheme(legacyTheme);
      refreshThemeSensitiveUI();
      return;
    }
  } catch (_) {}

  applyTheme('light');
  refreshThemeSensitiveUI();
}

function switchView(view) {
  currentView = view;
  const isHtml = view === 'html';

  document.getElementById('tabRaw').classList.toggle('active', !isHtml);
  document.getElementById('tabHtml').classList.toggle('active', isHtml);
  document.getElementById('btnGroupRaw').classList.toggle('hidden', isHtml);
  document.getElementById('btnGroupHtml').classList.toggle('hidden', !isHtml);
  document.getElementById('emailPreview').classList.toggle('hidden', isHtml);
  document.getElementById('previewModeLabel').textContent = isHtml ? 'HTML rendered view' : 'Raw text view';

  htmlPreviewFrame.classList.toggle('hidden', !isHtml);

  if (isHtml) refreshHtmlPreview();
}

function pushWholeFormToStore() {
  const snapshot = collectFormData();
  const signature = JSON.stringify(snapshot);
  if (signature === lastSharedStateSignature) return;
  lastSharedStateSignature = signature;

  replaceSharedState(snapshot, {
    source: APP_SOURCE
  });
}


function currentCustomizationSignature() {
  return JSON.stringify(currentDefaults());
}

function customizationDefaultsChanged() {
  const currentSignature = currentCustomizationSignature();

  try {
    const previousSignature = localStorage.getItem(CUSTOMIZATION_SIGNATURE_KEY);
    localStorage.setItem(CUSTOMIZATION_SIGNATURE_KEY, currentSignature);
    if (previousSignature === null) {
      return true;
    }

    return previousSignature !== currentSignature;
  } catch (_) {
    return false;
  }
}

function initializeSharedState(options = {}) {
  const { forceDefaults = false } = options;
  const defaultSnapshot = collectFormData();
  const persistedState = forceDefaults ? {} : migrateLegacyFormState(getSharedState());

  if (Object.keys(persistedState).length) {
    const merged = { ...defaultSnapshot, ...persistedState };
    applySnapshotToForm(merged);
    lastSharedStateSignature = JSON.stringify(collectFormData());
    replaceSharedState(collectFormData(), {
      source: APP_SOURCE,
      broadcast: false
    });
  } else {
    replaceSharedState(defaultSnapshot, {
      source: APP_SOURCE,
      broadcast: false
    });
    lastSharedStateSignature = JSON.stringify(defaultSnapshot);
  }

  subscribeToSharedState((nextState, meta = {}) => {
    if (meta.source === APP_SOURCE) return;

    const merged = { ...collectFormData(), ...migrateLegacyFormState(nextState) };
    applySnapshotToForm(merged);
    refreshPreview();
  });
}

function reinitializeForCustomizationChange() {
  const currentData = collectFormData();
  runtimeConfig = getRuntimeConfig();

  initializeSelects(currentData);
  applyTextDefaults(currentData);
  syncStructuredVesselSpecs();
  pushWholeFormToStore();
  refreshPreview();
}

function handleAnyInput(event) {
  if (isApplyingExternalState) return;

  const target = event.target;
  if (!target || !('name' in target)) return;

  if (target.id === 'vessel') {
    syncStructuredVesselSpecs();
  }

  pushWholeFormToStore();
  refreshPreview();
}

runtimeConfig = getRuntimeConfig();
initializeSelects();
applyTextDefaults();
syncStructuredVesselSpecs();
initializeSharedState({ forceDefaults: customizationDefaultsChanged() });
initializeTheme();
refreshPreview();

(async () => {
  try {
    const result = await syncRuntimeCustomizationFromServer({ force: false });
    if (result.configured && result.customization) {
      showStatus('Shared customization loaded.');
    }
  } catch (error) {
    console.error('Shared customization load failed:', error);
  }
})();

subscribeToRuntimeCustomization((_, meta = {}) => {
  if (meta.source === APP_SOURCE) return;
  reinitializeForCustomizationChange();
}, { immediate: false });

form.addEventListener('input', handleAnyInput);
form.addEventListener('change', handleAnyInput);

window.addEventListener('storage', (event) => {
  if (event.key === THEME_STORAGE_KEY && (event.newValue === 'dark' || event.newValue === 'light')) {
    applyTheme(event.newValue);
    refreshThemeSensitiveUI();
  }
});

document.getElementById('tabRaw').addEventListener('click', () => switchView('raw'));
document.getElementById('tabHtml').addEventListener('click', () => switchView('html'));

document.getElementById('copyRawBtn').addEventListener('click', async () => {
  try {
    const emailText = buildEmailText(collectFormData());
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(emailText.body);
      showStatus('Raw mail copied to clipboard.');
    } else {
      showStatus('Clipboard not available in this browser.');
    }
  } catch (_) {
    showStatus('Copy failed.');
  }
});

document.getElementById('copyHtmlBtn').addEventListener('click', async () => {
  try {
    const html = buildHtmlEmailDocument(collectFormData());
    const copiedRichHtml = await copyHtmlForRichPaste(html);
    if (copiedRichHtml) {
      showStatus('HTML mail copied as rich content (paste-ready).');
    } else if (navigator.clipboard?.writeText) {
      showStatus('HTML copied as text only. Rich paste may not be supported in this browser.');
    } else {
      showStatus('Clipboard not available in this browser.');
    }
  } catch (_) {
    showStatus('Copy failed.');
  }
});

document.getElementById('openDraftBtn').addEventListener('click', () => {
  const url = buildMailtoUrl(collectFormData(), { includeBody: true });
  window.location.href = url;
});

document.getElementById('openDraftHtmlBtn').addEventListener('click', async () => {
  const formData = collectFormData();
  const html = buildHtmlEmailDocument(formData);
  let copiedRichHtml = false;
  let copyFailed = false;

  try {
    copiedRichHtml = await copyHtmlForRichPaste(html);
  } catch (_) {
    copyFailed = true;
  }

  const url = buildMailtoUrl(formData, { includeBody: false });
  window.location.href = url;

  if (copiedRichHtml) {
    showStatus('Draft opened. HTML is copied as rich content and ready to paste.');
  } else if (copyFailed) {
    showStatus('Draft opened, but copy failed. Paste may require manual copy from HTML Preview.');
  } else {
    showStatus('Draft opened. HTML copied as text only; rich paste may not be supported here.');
  }
});

document.getElementById('autofillCargoBtn')?.addEventListener('click', () => {
  applyCargoOfferAutofill();
});

document.getElementById('clearCargoInputBtn')?.addEventListener('click', () => {
  if (cargoOfferInput) cargoOfferInput.value = '';
  setCargoOfferStatus('');
});
