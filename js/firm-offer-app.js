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
const validationPanel = document.getElementById('validationPanel');
const validationList = document.getElementById('validationList');
const warningOverrideInput = document.getElementById('warningOverride');
const warningOverrideRow = document.getElementById('warningOverrideRow');
const sendButtons = [
  document.getElementById('openDraftBtn'),
  document.getElementById('openDraftHtmlBtn')
].filter(Boolean);

const fieldElements = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]'));
const fieldNames = fieldElements.map((element) => element.name);

let currentView = 'raw';
let isApplyingExternalState = false;
let lastSharedStateSignature = '';
let latestValidation = { issues: [], hasCritical: false, hasWarnings: false };
let analyticsIssueSignature = '';
const previousFieldValues = {};

const REQUIRED_FIELDS = ['emailTo', 'cargo', 'laycanDate', 'pol', 'pod', 'freightAmount', 'demdetAmount', 'terms', 'currency'];
const CRITICAL_RULES = new Set(['missing_required', 'invalid_validity_date']);

const TLD_LOCALE_MAP = {
  tr: 'tr-TR',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  nl: 'nl-NL',
  be: 'nl-BE',
  uk: 'en-GB',
  gb: 'en-GB',
  se: 'sv-SE',
  no: 'nb-NO',
  dk: 'da-DK',
  pl: 'pl-PL',
  ro: 'ro-RO',
  ae: 'ar-AE',
  sa: 'ar-SA',
  qa: 'ar-QA',
  jp: 'ja-JP',
  cn: 'zh-CN'
};

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

function parseLocalizedNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimalDigits = compact.length - lastComma - 1;
    normalized = decimalDigits === 3 ? compact.replace(/,/g, '') : compact.replace(',', '.');
  } else if (lastDot > -1) {
    const decimalDigits = compact.length - lastDot - 1;
    normalized = decimalDigits === 3 ? compact.replace(/\./g, '') : compact;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function guessLocaleFromRecipient(emailTo) {
  const firstAddress = trimmed(emailTo).split(/[;, ]+/).find(Boolean) || '';
  const domain = firstAddress.includes('@') ? firstAddress.split('@')[1] : '';
  const tld = domain.split('.').pop()?.toLowerCase() || '';
  return TLD_LOCALE_MAP[tld] || navigator.language || 'en-US';
}

function formatNumberForLocale(value, locale, options = {}) {
  const parsed = parseLocalizedNumber(value);
  if (parsed === null) return String(value ?? '');
  return new Intl.NumberFormat(locale, options).format(parsed);
}

function formatDateForLocale(value, locale) {
  const raw = trimmed(value);
  if (!raw) return raw;
  const directDate = new Date(raw);
  if (!Number.isNaN(directDate.getTime())) {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: '2-digit' }).format(directDate);
  }

  const rangeMatch = raw.match(/^(\d{1,2})-(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!rangeMatch) return raw;
  const [, fromDay, toDay, monthText, yearText] = rangeMatch;
  const parsedMonth = new Date(`${monthText} 1, ${yearText}`);
  if (Number.isNaN(parsedMonth.getTime())) return raw;
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' });
  const monthPart = monthFormatter.format(parsedMonth);
  return `${fromDay.padStart(2, '0')}-${toDay.padStart(2, '0')} ${monthPart} ${yearText}`;
}

function localizedFormData(data) {
  const locale = guessLocaleFromRecipient(data.emailTo);
  return {
    ...data,
    laycanDate: formatDateForLocale(data.laycanDate, locale),
    freightAmount: formatNumberForLocale(data.freightAmount, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    demdetAmount: formatNumberForLocale(data.demdetAmount, locale, { maximumFractionDigits: 2 }),
    commissionPercentage: formatNumberForLocale(data.commissionPercentage, locale, { maximumFractionDigits: 2 })
  };
}

function parseAnyDate(value) {
  const raw = trimmed(value);
  if (!raw) return null;
  const rangeMatch = raw.match(/^(\d{1,2})-(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (rangeMatch) {
    const [, fromDay, , monthText, yearText] = rangeMatch;
    const parsed = new Date(`${monthText} ${fromDay}, ${yearText}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!dmy) return null;
  const [, dd, mm, yy] = dmy;
  const year = yy.length === 2 ? `20${yy}` : yy;
  const parsed = new Date(Number(year), Number(mm) - 1, Number(dd));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPresendValidation(data) {
  const issues = [];

  REQUIRED_FIELDS.forEach((name) => {
    if (!trimmed(data[name])) {
      issues.push({
        type: 'missing_required',
        severity: 'critical',
        field: name,
        message: `${name} is required before send.`,
        action: previousFieldValues[name]
          ? { label: 'Use previous value', type: 'use_previous', field: name }
          : { label: 'Fix with default', type: 'use_default', field: name }
      });
    }
  });

  const freightValue = parseLocalizedNumber(data.freightAmount);
  const demdetValue = parseLocalizedNumber(data.demdetAmount);
  if ((freightValue !== null && freightValue < 0) || (demdetValue !== null && demdetValue < 0)) {
    issues.push({
      type: 'invalid_number',
      severity: 'critical',
      message: 'Freight and Dem/Det amounts must be positive numbers.',
      action: { label: 'Fix with default', type: 'use_default', field: freightValue !== null && freightValue < 0 ? 'freightAmount' : 'demdetAmount' }
    });
  }

  if (trimmed(data.currency) && /EUR|EURO/i.test(data.currency) && /usd/i.test(`${data.freightTerms} ${data.extraClauses}`)) {
    issues.push({
      type: 'unit_currency_inconsistency',
      severity: 'warning',
      message: 'Currency is EUR while terms/clauses reference USD.',
      action: { label: 'Fix with default', type: 'use_default', field: 'currency' }
    });
  }

  const laycanDate = parseAnyDate(data.laycanDate);
  if (!laycanDate) {
    issues.push({
      type: 'invalid_validity_date',
      severity: 'critical',
      field: 'laycanDate',
      message: 'Laycan/validity date is invalid.',
      action: { label: 'Update date to +7 days', type: 'plus_seven_days', field: 'laycanDate' }
    });
  } else {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (laycanDate < now) {
      issues.push({
        type: 'invalid_validity_date',
        severity: 'critical',
        field: 'laycanDate',
        message: 'Laycan/validity date appears expired.',
        action: { label: 'Update date to +7 days', type: 'plus_seven_days', field: 'laycanDate' }
      });
    }
  }

  const subjectText = trimmed(data.emailSubject).toLowerCase();
  const bodyText = buildEmailText(localizedFormData(data)).body.toLowerCase();
  if (subjectText && bodyText && !bodyText.includes(subjectText.split(/\s+/)[0])) {
    issues.push({
      type: 'subject_body_mismatch',
      severity: 'warning',
      field: 'emailSubject',
      message: 'Subject may not match body content.',
      action: { label: 'Use previous value', type: 'use_previous', field: 'emailSubject' }
    });
  }

  return {
    issues,
    hasCritical: issues.some((issue) => CRITICAL_RULES.has(issue.type) || issue.severity === 'critical'),
    hasWarnings: issues.some((issue) => issue.severity === 'warning')
  };
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

function buildHtmlPreviewDocument(data = collectFormData()) {
  const html = buildHtmlEmailDocument(data);
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
  const data = localizedFormData(collectFormData());
  htmlPreviewFrame.srcdoc = buildHtmlPreviewDocument(data);
}

function applyFixAction(action) {
  if (!action || !action.field) return;
  const element = getFieldElement(action.field);
  if (!element) return;

  if (action.type === 'use_previous' && previousFieldValues[action.field]) {
    element.value = previousFieldValues[action.field];
  } else if (action.type === 'plus_seven_days') {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 7);
    element.value = nextDate.toISOString().slice(0, 10);
  } else if (action.type === 'use_default') {
    const defaults = currentDefaults();
    if (defaults[action.field] !== undefined) {
      element.value = String(defaults[action.field]);
    } else {
      element.value = '';
    }
  }

  pushWholeFormToStore();
  refreshPreview();
}

function logValidationAnalytics(validation) {
  const signature = validation.issues.map((issue) => issue.type).sort().join('|');
  if (signature === analyticsIssueSignature) return;
  analyticsIssueSignature = signature;

  const issueTypes = validation.issues.map((issue) => issue.type);
  if (window.dataLayer && Array.isArray(window.dataLayer)) {
    window.dataLayer.push({
      event: 'pre_send_validation',
      issueTypes
    });
  }
  if (issueTypes.length) {
    console.info('Pre-send validation issues:', issueTypes);
  }
}

function renderValidation(validation) {
  if (!validationPanel || !validationList) return;
  validationList.innerHTML = '';
  validationPanel.classList.toggle('hidden', validation.issues.length === 0);
  warningOverrideRow?.classList.toggle('hidden', !validation.hasWarnings || validation.hasCritical);

  validation.issues.forEach((issue) => {
    const row = document.createElement('div');
    row.className = `validation-item ${issue.severity}`;

    const text = document.createElement('div');
    text.className = 'validation-message';
    text.textContent = issue.message;
    row.appendChild(text);

    if (issue.action) {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'secondary validation-fix';
      actionBtn.textContent = issue.action.label;
      actionBtn.addEventListener('click', () => applyFixAction(issue.action));
      row.appendChild(actionBtn);
    }

    validationList.appendChild(row);
  });
}

function updateSendGuards(validation) {
  const allowWarnings = warningOverrideInput?.checked;
  sendButtons.forEach((button) => {
    if (!button) return;
    const blocked = validation.hasCritical || (validation.hasWarnings && !allowWarnings);
    button.disabled = blocked;
  });
}

function refreshPreview() {
  updateConditionalUI();
  syncStructuredVesselSpecs();

  const data = collectFormData();
  const localizedData = localizedFormData(data);
  const emailText = buildEmailText(localizedData);

  subjectPreview.textContent = emailText.subject;
  toPreview.textContent = trimmed(data.emailTo) || '—';
  ccPreview.textContent = trimmed(data.emailCc) || '—';
  emailPreview.textContent = emailText.body;

  latestValidation = buildPresendValidation(data);
  renderValidation(latestValidation);
  logValidationAnalytics(latestValidation);
  updateSendGuards(latestValidation);

  if (!htmlPreviewFrame.classList.contains('hidden')) {
    refreshHtmlPreview();
  }
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

  if (target.type !== 'checkbox' && trimmed(target.value)) {
    previousFieldValues[target.name] = target.value;
  }

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
Object.assign(previousFieldValues, collectFormData());
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
warningOverrideInput?.addEventListener('change', () => updateSendGuards(latestValidation));

document.getElementById('copyRawBtn').addEventListener('click', async () => {
  try {
    const emailText = buildEmailText(localizedFormData(collectFormData()));
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
    const html = buildHtmlEmailDocument(localizedFormData(collectFormData()));
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
  if (latestValidation.hasCritical || (latestValidation.hasWarnings && !warningOverrideInput?.checked)) {
    showStatus('Resolve critical issues or enable warning override before sending.');
    return;
  }
  const url = buildMailtoUrl(localizedFormData(collectFormData()), { includeBody: true });
  window.location.href = url;
});

document.getElementById('openDraftHtmlBtn').addEventListener('click', async () => {
  if (latestValidation.hasCritical || (latestValidation.hasWarnings && !warningOverrideInput?.checked)) {
    showStatus('Resolve critical issues or enable warning override before sending.');
    return;
  }
  const formData = localizedFormData(collectFormData());
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
