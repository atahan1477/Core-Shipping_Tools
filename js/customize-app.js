import {
  baseConfig,
  getRuntimeConfig,
  saveRuntimeCustomization,
  clearRuntimeCustomization,
  syncRuntimeCustomizationFromServer,
  pushRuntimeCustomizationToServer,
  resetRuntimeCustomizationOnServer
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
const adminPasswordInput = document.getElementById('adminPassword');
const vesselSelect = document.getElementById('customizerVesselSelect');
const vesselNameInput = document.getElementById('customizerVesselName');
const rawSpecsInput = document.getElementById('customizerRawSpecs');
const structuredSpecsGrid = document.getElementById('structuredSpecsGrid');
const addSpecRowBtn = document.getElementById('addSpecRowBtn');
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
  }, 3600);
}

function createWorkingCopy(source) {
  const next = clone(source);
  next.termBehavior = clone(source.termBehavior || {});
  next.vesselStructuredSpecs = clone(source.vesselStructuredSpecs || {});
  return next;
}

function createSpecRow(index = 0) {
  return {
    id: `spec_${Date.now()}_${index}`,
    enabled: true,
    order: index + 1,
    label: '',
    value: '-',
    htmlLine: Math.floor(index / 2) + 1
  };
}

function getTemplateVessel() {
  return working.vesselOptions[0] || selectedVessel || '';
}

function normalizeRows(rows = []) {
  return rows
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((row, index) => ({
      ...row,
      id: row.id || `spec_${Date.now()}_${index}`,
      enabled: row?.enabled !== false,
      order: index + 1,
      htmlLine: Number(row?.htmlLine) || Math.floor(index / 2) + 1
    }));
}

function cloneRowMeta(row, index) {
  return {
    id: row.id || `spec_${Date.now()}_${index}`,
    enabled: row.enabled !== false,
    order: Number(row.order) || (index + 1),
    label: String(row.label || ''),
    htmlLine: Number(row.htmlLine) || Math.floor(index / 2) + 1
  };
}

function ensureVesselRecord(vessel) {
  if (!working.vesselSpecs[vessel]) working.vesselSpecs[vessel] = '';
  if (!Array.isArray(working.vesselStructuredSpecs[vessel])) {
    const legacy = working.vesselStructuredSpecs[vessel];
    if (legacy && typeof legacy === 'object') {
      working.vesselStructuredSpecs[vessel] = Object.entries(legacy).map(([key, value], index) => ({
        id: key,
        enabled: true,
        order: index + 1,
        label: key,
        value: String(value ?? '').trim(),
        htmlLine: Math.floor(index / 2) + 1
      }));
    } else {
      working.vesselStructuredSpecs[vessel] = [];
    }
  }
  working.vesselStructuredSpecs[vessel] = normalizeRows(working.vesselStructuredSpecs[vessel]);
}

function alignAllVesselRowsToTemplate() {
  const templateVessel = getTemplateVessel();
  if (!templateVessel) return;
  ensureVesselRecord(templateVessel);

  const templateRows = normalizeRows(working.vesselStructuredSpecs[templateVessel]);
  working.vesselStructuredSpecs[templateVessel] = templateRows;

  working.vesselOptions.forEach((vessel) => {
    ensureVesselRecord(vessel);
    const existingById = new Map((working.vesselStructuredSpecs[vessel] || []).map((row) => [row.id, row]));
    working.vesselStructuredSpecs[vessel] = templateRows.map((templateRow, index) => {
      const existing = existingById.get(templateRow.id);
      return {
        ...cloneRowMeta(templateRow, index),
        value: String(existing?.value ?? '-').trim() || '-'
      };
    });
  });
}

function updateRowMetaForAllVessels(rowId, updater) {
  working.vesselOptions.forEach((vessel) => {
    ensureVesselRecord(vessel);
    const row = working.vesselStructuredSpecs[vessel].find((item) => item.id === rowId);
    if (row) updater(row);
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
  alignAllVesselRowsToTemplate();
  ensureVesselRecord(selectedVessel);
  structuredSpecsGrid.innerHTML = '';

  const rows = normalizeRows(working.vesselStructuredSpecs[selectedVessel]);

  working.vesselStructuredSpecs[selectedVessel] = rows;

  rows.forEach((specRow, index) => {
    const row = document.createElement('div');
    row.className = 'structured-row';

    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = specRow.enabled !== false;
    enabledInput.title = 'Enabled in output';
    enabledInput.addEventListener('change', () => {
      updateRowMetaForAllVessels(specRow.id, (rowItem) => {
        rowItem.enabled = enabledInput.checked;
      });
      refreshPreview();
    });

    const orderInput = document.createElement('input');
    orderInput.type = 'number';
    orderInput.className = 'mini-input';
    orderInput.min = '1';
    orderInput.value = String(specRow.order || (index + 1));
    orderInput.title = 'Order';
    orderInput.addEventListener('change', () => {
      const nextOrder = Math.max(1, Number.parseInt(orderInput.value, 10) || (index + 1));
      updateRowMetaForAllVessels(specRow.id, (rowItem) => {
        rowItem.order = nextOrder;
      });
      renderStructuredSpecsGrid();
      refreshPreview();
    });

    const labelInput = document.createElement('input');
    labelInput.value = specRow.label || '';
    labelInput.placeholder = 'Spec label (e.g. DWCC)';
    labelInput.addEventListener('input', () => {
      updateRowMetaForAllVessels(specRow.id, (rowItem) => {
        rowItem.label = labelInput.value;
      });
      refreshPreview();
    });

    const valueInput = document.createElement('input');
    valueInput.value = specRow.value || '';
    valueInput.placeholder = `Spec value for ${selectedVessel}`;
    valueInput.addEventListener('input', () => {
      specRow.value = valueInput.value;
      refreshPreview();
    });

    const htmlLineInput = document.createElement('input');
    htmlLineInput.type = 'number';
    htmlLineInput.className = 'mini-input';
    htmlLineInput.min = '1';
    htmlLineInput.value = String(specRow.htmlLine || (Math.floor(index / 2) + 1));
    htmlLineInput.title = 'HTML line group';
    htmlLineInput.addEventListener('change', () => {
      const nextHtmlLine = Math.max(1, Number.parseInt(htmlLineInput.value, 10) || 1);
      updateRowMetaForAllVessels(specRow.id, (rowItem) => {
        rowItem.htmlLine = nextHtmlLine;
      });
      refreshPreview();
    });

    const actions = document.createElement('div');
    actions.className = 'inline-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'secondary icon-btn';
    upBtn.textContent = '↑';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => {
      if (index === 0) return;
      const currentList = working.vesselStructuredSpecs[selectedVessel];
      const prevRowId = currentList[index - 1]?.id;
      const currentRowId = currentList[index]?.id;
      if (!prevRowId || !currentRowId) return;
      updateRowMetaForAllVessels(prevRowId, (rowItem) => { rowItem.order = index + 1; });
      updateRowMetaForAllVessels(currentRowId, (rowItem) => { rowItem.order = index; });
      renderStructuredSpecsGrid();
      refreshPreview();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'secondary icon-btn';
    downBtn.textContent = '↓';
    downBtn.disabled = index === rows.length - 1;
    downBtn.addEventListener('click', () => {
      if (index >= rows.length - 1) return;
      const currentList = working.vesselStructuredSpecs[selectedVessel];
      const nextRowId = currentList[index + 1]?.id;
      const currentRowId = currentList[index]?.id;
      if (!nextRowId || !currentRowId) return;
      updateRowMetaForAllVessels(nextRowId, (rowItem) => { rowItem.order = index + 1; });
      updateRowMetaForAllVessels(currentRowId, (rowItem) => { rowItem.order = index + 2; });
      renderStructuredSpecsGrid();
      refreshPreview();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'danger icon-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      working.vesselOptions.forEach((vessel) => {
        ensureVesselRecord(vessel);
        working.vesselStructuredSpecs[vessel] = working.vesselStructuredSpecs[vessel].filter((rowItem) => rowItem.id !== specRow.id);
      });
      renderStructuredSpecsGrid();
      refreshPreview();
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    row.appendChild(enabledInput);
    row.appendChild(orderInput);
    row.appendChild(labelInput);
    row.appendChild(valueInput);
    row.appendChild(htmlLineInput);
    row.appendChild(actions);
    structuredSpecsGrid.appendChild(row);
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
  alignAllVesselRowsToTemplate();
  ensureTermBehaviorRecords();
  if (!working.vesselOptions.includes(selectedVessel)) {
    selectedVessel = working.vesselOptions[0] || '';
  }
  renderVesselSelector();
  renderSelectedVesselEditor();
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

function getAdminPassword() {
  return String(adminPasswordInput?.value || '').trim();
}

async function reloadSharedCustomization(force = true) {
  const result = await syncRuntimeCustomizationFromServer({ force });
  working = createWorkingCopy(getRuntimeConfig());
  selectedVessel = working.vesselOptions[0] || '';
  renderAll();
  return result;
}

document.getElementById('loadSavedBtn').addEventListener('click', async () => {
  try {
    const result = await reloadSharedCustomization(true);
    if (result.configured === false) {
      showStatus('Shared storage is not configured yet. Using local/default data.', true);
      return;
    }
    showStatus('Shared customization reloaded.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('saveCustomizeBtn').addEventListener('click', async () => {
  try {
    const adminPassword = getAdminPassword();
    if (!adminPassword) {
      throw new Error('Enter the admin save password first.');
    }

    const payload = buildCustomizationPayload();
    const response = await pushRuntimeCustomizationToServer(payload, adminPassword);
    working = createWorkingCopy(getRuntimeConfig());
    selectedVessel = working.vesselOptions[0] || '';
    renderAll();
    showStatus(response.writable === false
      ? 'Saved locally, but shared writing is not enabled on Vercel.'
      : 'Shared customization saved. All users will see it after refresh.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('resetAllBtn').addEventListener('click', async () => {
  try {
    if (!window.confirm('Reset the shared customization for all users?')) return;

    const adminPassword = getAdminPassword();
    if (!adminPassword) {
      throw new Error('Enter the admin save password first.');
    }

    await resetRuntimeCustomizationOnServer(adminPassword);
    clearRuntimeCustomization({ source: 'customize-app-reset' });
    working = createWorkingCopy(baseConfig);
    working.termBehavior = clone(getRuntimeConfig().termBehavior || {});
    selectedVessel = working.vesselOptions[0] || '';
    renderAll();
    customizationJson.value = '';
    showStatus('Shared customization reset. All users will see defaults after refresh.');
  } catch (error) {
    showStatus(error.message, true);
  }
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
    showStatus('Imported JSON loaded into the editor. Click Save for All Users to apply it.');
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
  alignAllVesselRowsToTemplate();
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

addSpecRowBtn.addEventListener('click', () => {
  const templateVessel = getTemplateVessel();
  ensureVesselRecord(templateVessel);
  const nextIndex = working.vesselStructuredSpecs[templateVessel].length;
  const newRow = createSpecRow(nextIndex);

  working.vesselOptions.forEach((vessel) => {
    ensureVesselRecord(vessel);
    working.vesselStructuredSpecs[vessel].push({
      ...cloneRowMeta(newRow, nextIndex),
      value: '-'
    });
  });
  renderStructuredSpecsGrid();
  refreshPreview();
  showStatus('New structured spec row added for all vessels (value remains vessel-specific).');
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

(async () => {
  try {
    const result = await reloadSharedCustomization(true);
    if (result.configured === false) {
      showStatus('Shared storage is not configured yet. Generator customization is using local/default data.', true);
      return;
    }
    if (result.customization) {
      showStatus('Shared customization loaded.');
    } else {
      showStatus('No shared customization saved yet. Defaults are active.');
    }
  } catch (error) {
    showStatus(`Shared load failed: ${error.message}`, true);
  }
})();
