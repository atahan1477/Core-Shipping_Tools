import {
  baseConfig,
  getRuntimeConfig,
  saveRuntimeCustomization,
  clearRuntimeCustomization,
  loadRuntimeCustomization,
  slugifyFieldId
} from '../shared/config.js';

const optionGroups = [
  { key: 'underDeckOptions', label: 'Under deck wording options' },
  { key: 'cargoStackableOptions', label: 'Cargo stackable wording options' },
  { key: 'currencyOptions', label: 'Freight currency options' },
  { key: 'freightTermsOptions', label: 'Freight terms options' },
  { key: 'termsOptions', label: 'Terms options' },
  { key: 'laytimeTermsOptions', label: 'Laytime terms options' },
  { key: 'agentOptions', label: 'Agent options' }
];

const statusEl = document.getElementById('status');
const vesselSelect = document.getElementById('customizerVesselSelect');
const vesselNameInput = document.getElementById('customizerVesselName');
const rawSpecsInput = document.getElementById('customizerRawSpecs');
const structuredSpecsGrid = document.getElementById('structuredSpecsGrid');
const specFieldList = document.getElementById('specFieldList');
const optionEditors = document.getElementById('optionEditors');
const termBehaviorList = document.getElementById('termBehaviorList');
const defaultsJson = document.getElementById('defaultsJson');
const customizationJson = document.getElementById('customizationJson');
const currentPreview = document.getElementById('currentPreview');

let working = createWorkingCopy(getRuntimeConfig());
let selectedVessel = working.vesselOptions[0] || '';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#a53434' : '#166a52';
  setTimeout(() => {
    if (statusEl.textContent === message) {
      statusEl.textContent = '';
      statusEl.style.color = '#166a52';
    }
  }, 3200);
}

function createWorkingCopy(source) {
  const next = clone(source);
  next.termBehavior = clone(source.termBehavior || {});
  next.vesselStructuredSpecs = clone(source.vesselStructuredSpecs || {});
  return next;
}

function ensureVesselRecord(vessel) {
  if (!working.vesselSpecs[vessel]) working.vesselSpecs[vessel] = '';
  if (!working.vesselStructuredSpecs[vessel]) working.vesselStructuredSpecs[vessel] = {};

  working.vesselSpecFieldOptions.forEach((field) => {
    if (!(field.id in working.vesselStructuredSpecs[vessel])) {
      working.vesselStructuredSpecs[vessel][field.id] = '';
    }
  });
}

function ensureTermBehaviorRecords() {
  working.termsOptions.forEach((term) => {
    if (!working.termBehavior[term]) {
      working.termBehavior[term] = {
        mode: 'laytime',
        meaning: `${term} selected.`,
        structure: 'Selected structure: day-based loading / discharging laytime fields.'
      };
    }
  });
}

function renderVesselSelector() {
  vesselSelect.innerHTML = '';
  working.vesselOptions.forEach((vessel) => {
    const option = document.createElement('option');
    option.value = vessel;
    option.textContent = vessel;
    if (vessel === selectedVessel) option.selected = true;
    vesselSelect.appendChild(option);
  });
}

function renderSelectedVesselEditor() {
  ensureVesselRecord(selectedVessel);
  vesselNameInput.value = selectedVessel;
  rawSpecsInput.value = working.vesselSpecs[selectedVessel] || '';
  renderStructuredSpecsGrid();
}

function renderStructuredSpecsGrid() {
  ensureVesselRecord(selectedVessel);
  structuredSpecsGrid.innerHTML = '';

  working.vesselSpecFieldOptions.forEach((field) => {
    const row = document.createElement('label');
    row.className = 'structured-row';

    const title = document.createElement('strong');
    title.textContent = field.label;

    const input = document.createElement('textarea');
    input.className = 'small';
    input.value = working.vesselStructuredSpecs[selectedVessel]?.[field.id] || '';
    input.placeholder = `${field.label} value for ${selectedVessel}`;
    input.addEventListener('input', () => {
      working.vesselStructuredSpecs[selectedVessel][field.id] = input.value;
      refreshPreview();
    });

    row.appendChild(title);
    row.appendChild(input);
    structuredSpecsGrid.appendChild(row);
  });
}

function renderSpecFieldList() {
  specFieldList.innerHTML = '';

  working.vesselSpecFieldOptions.forEach((field) => {
    const row = document.createElement('div');
    row.className = 'repeat-row';

    const labelInput = document.createElement('input');
    labelInput.value = field.label;
    labelInput.placeholder = 'Field label';
    labelInput.addEventListener('input', () => {
      field.label = labelInput.value;
      renderStructuredSpecsGrid();
      refreshPreview();
    });

    const idBadge = document.createElement('span');
    idBadge.className = 'pill';
    idBadge.textContent = field.id;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      working.vesselSpecFieldOptions = working.vesselSpecFieldOptions.filter((item) => item.id !== field.id);
      Object.values(working.vesselStructuredSpecs).forEach((record) => {
        delete record[field.id];
      });
      working.formDefaults.selectedVesselSpecFields = String(working.formDefaults.selectedVesselSpecFields || '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value && value !== field.id)
        .join(',');
      renderAll();
      refreshPreview();
    });

    row.appendChild(labelInput);
    row.appendChild(idBadge);
    row.appendChild(removeBtn);
    specFieldList.appendChild(row);
  });
}

function renderOptionEditors() {
  optionEditors.innerHTML = '';

  optionGroups.forEach((group) => {
    const card = document.createElement('div');
    card.className = 'option-card';

    const title = document.createElement('h3');
    title.textContent = group.label;
    card.appendChild(title);

    const list = document.createElement('div');
    list.className = 'repeat-list';

    (working[group.key] || []).forEach((value, index) => {
      const row = document.createElement('div');
      row.className = 'repeat-row';

      const input = document.createElement('input');
      input.value = value;
      input.addEventListener('input', () => {
        working[group.key][index] = input.value;
        refreshPreview();
      });

      const badge = document.createElement('span');
      badge.className = 'pill';
      badge.textContent = `${index + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'danger';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        working[group.key].splice(index, 1);
        if (group.key === 'termsOptions') {
          ensureTermBehaviorRecords();
        }
        renderAll();
        refreshPreview();
      });

      row.appendChild(input);
      row.appendChild(badge);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'secondary';
    addBtn.textContent = `+ Add option`;
    addBtn.addEventListener('click', () => {
      working[group.key].push('');
      renderAll();
      refreshPreview();
    });

    card.appendChild(list);
    card.appendChild(addBtn);
    optionEditors.appendChild(card);
  });
}

function renderTermBehaviorList() {
  ensureTermBehaviorRecords();
  termBehaviorList.innerHTML = '';

  working.termsOptions.forEach((term) => {
    const record = working.termBehavior[term] || { mode: 'laytime', meaning: '', structure: '' };

    const wrapper = document.createElement('div');
    wrapper.className = 'option-card';

    const heading = document.createElement('h3');
    heading.textContent = term;
    wrapper.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'grid';

    const modeField = document.createElement('div');
    modeField.className = 'field';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Mode';
    const modeSelect = document.createElement('select');
    ['laytime', 'text'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (record.mode === value) option.selected = true;
      modeSelect.appendChild(option);
    });
    modeSelect.addEventListener('change', () => {
      working.termBehavior[term].mode = modeSelect.value;
      refreshPreview();
    });
    modeField.appendChild(modeLabel);
    modeField.appendChild(modeSelect);

    const meaningField = document.createElement('div');
    meaningField.className = 'field';
    const meaningLabel = document.createElement('label');
    meaningLabel.textContent = 'Meaning';
    const meaningInput = document.createElement('textarea');
    meaningInput.className = 'small';
    meaningInput.value = record.meaning || '';
    meaningInput.addEventListener('input', () => {
      working.termBehavior[term].meaning = meaningInput.value;
      refreshPreview();
    });
    meaningField.appendChild(meaningLabel);
    meaningField.appendChild(meaningInput);

    const structureField = document.createElement('div');
    structureField.className = 'field full';
    const structureLabel = document.createElement('label');
    structureLabel.textContent = 'Structure note';
    const structureInput = document.createElement('textarea');
    structureInput.className = 'small';
    structureInput.value = record.structure || '';
    structureInput.addEventListener('input', () => {
      working.termBehavior[term].structure = structureInput.value;
      refreshPreview();
    });
    structureField.appendChild(structureLabel);
    structureField.appendChild(structureInput);

    grid.appendChild(modeField);
    grid.appendChild(meaningField);
    wrapper.appendChild(grid);
    wrapper.appendChild(structureField);
    termBehaviorList.appendChild(wrapper);
  });
}

function refreshPreview() {
  currentPreview.textContent = JSON.stringify(working, null, 2);
}

function renderAll() {
  ensureTermBehaviorRecords();
  if (!working.vesselOptions.includes(selectedVessel)) {
    selectedVessel = working.vesselOptions[0] || '';
  }
  renderVesselSelector();
  renderSelectedVesselEditor();
  renderSpecFieldList();
  renderOptionEditors();
  renderTermBehaviorList();
  defaultsJson.value = JSON.stringify(working.formDefaults, null, 2);
  refreshPreview();
}

function readDefaultsJson() {
  try {
    const parsed = JSON.parse(defaultsJson.value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Defaults JSON must be an object.');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Defaults JSON is invalid: ${error.message}`);
  }
}

function buildCustomizationPayload() {
  const payload = clone(working);
  payload.formDefaults = readDefaultsJson();
  return payload;
}

document.getElementById('loadSavedBtn').addEventListener('click', () => {
  working = createWorkingCopy(getRuntimeConfig());
  selectedVessel = working.vesselOptions[0] || '';
  renderAll();
  showStatus('Saved customization reloaded.');
});

document.getElementById('saveCustomizeBtn').addEventListener('click', () => {
  try {
    const saved = saveRuntimeCustomization(buildCustomizationPayload(), { source: 'customize-app' });
    working = createWorkingCopy(saved);
    renderAll();
    showStatus('Customization saved. Refresh the generator page if it is already open.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('resetAllBtn').addEventListener('click', () => {
  if (!window.confirm('Reset all saved customizations on this domain?')) return;
  clearRuntimeCustomization({ source: 'customize-app' });
  working = createWorkingCopy(baseConfig);
  working.termBehavior = clone(getRuntimeConfig().termBehavior || {});
  selectedVessel = working.vesselOptions[0] || '';
  renderAll();
  customizationJson.value = '';
  showStatus('All saved customizations were reset.');
});

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  try {
    customizationJson.value = JSON.stringify(buildCustomizationPayload(), null, 2);
    showStatus('Customization JSON exported to the textarea.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('importJsonBtn').addEventListener('click', () => {
  try {
    const parsed = JSON.parse(customizationJson.value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Imported JSON must be an object.');
    }
    working = createWorkingCopy(parsed);
    selectedVessel = working.vesselOptions?.[0] || '';
    renderAll();
    showStatus('Imported JSON loaded into the editor. Click Save Changes to apply it.');
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, true);
  }
});

document.getElementById('addVesselBtn').addEventListener('click', () => {
  const vesselName = window.prompt('New vessel name');
  if (!vesselName) return;
  const clean = vesselName.trim();
  if (!clean) return;
  if (working.vesselOptions.includes(clean)) {
    showStatus('That vessel already exists.', true);
    return;
  }
  working.vesselOptions.push(clean);
  ensureVesselRecord(clean);
  selectedVessel = clean;
  renderAll();
  showStatus('New vessel added.');
});

document.getElementById('removeVesselBtn').addEventListener('click', () => {
  if (!selectedVessel) return;
  if (!window.confirm(`Remove ${selectedVessel}?`)) return;
  working.vesselOptions = working.vesselOptions.filter((vessel) => vessel !== selectedVessel);
  delete working.vesselSpecs[selectedVessel];
  delete working.vesselStructuredSpecs[selectedVessel];
  selectedVessel = working.vesselOptions[0] || '';
  renderAll();
  showStatus('Vessel removed.');
});

document.getElementById('addSpecFieldBtn').addEventListener('click', () => {
  const label = window.prompt('New checkbox field label');
  if (!label) return;
  let id = slugifyFieldId(label);
  const used = new Set(working.vesselSpecFieldOptions.map((field) => field.id));
  while (used.has(id)) {
    id = `${id}_x`;
  }
  working.vesselSpecFieldOptions.push({ id, label: label.trim() });
  Object.keys(working.vesselStructuredSpecs).forEach((vessel) => {
    if (!working.vesselStructuredSpecs[vessel]) working.vesselStructuredSpecs[vessel] = {};
    working.vesselStructuredSpecs[vessel][id] = '';
  });
  renderAll();
  showStatus('New checkbox field added.');
});

vesselSelect.addEventListener('change', () => {
  selectedVessel = vesselSelect.value;
  renderSelectedVesselEditor();
});

vesselNameInput.addEventListener('input', () => {
  const next = vesselNameInput.value;
  if (!selectedVessel) return;
  const index = working.vesselOptions.indexOf(selectedVessel);
  if (index === -1) return;
  working.vesselOptions[index] = next;
  working.vesselSpecs[next] = working.vesselSpecs[selectedVessel] || '';
  working.vesselStructuredSpecs[next] = working.vesselStructuredSpecs[selectedVessel] || {};
  if (next !== selectedVessel) {
    delete working.vesselSpecs[selectedVessel];
    delete working.vesselStructuredSpecs[selectedVessel];
    selectedVessel = next;
  }
  renderVesselSelector();
  refreshPreview();
});

rawSpecsInput.addEventListener('input', () => {
  if (!selectedVessel) return;
  working.vesselSpecs[selectedVessel] = rawSpecsInput.value;
  refreshPreview();
});

working = createWorkingCopy(getRuntimeConfig());
selectedVessel = working.vesselOptions[0] || '';
renderAll();
