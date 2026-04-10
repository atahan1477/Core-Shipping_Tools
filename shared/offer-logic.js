import { TERM_BEHAVIOR } from './config.js';

export function trimmed(value) {
  return (value || '').trim();
}

export function vesselFinal(value) {
  const vessel = trimmed(value);
  if (!vessel) return '';
  if (vessel === 'CORE TBN' || /\bor sub\b/i.test(vessel)) return vessel;
  return `${vessel} or sub`;
}

export function buildAutoVesselSpecs(vessel, vesselSpecsMap = {}) {
  const base = trimmed(vessel);
  const specs = trimmed(vesselSpecsMap[base] || '');
  if (!base || !specs) return '';
  const separator = base.length > 16 ? '----------------------' : '---------------';
  return `${vesselFinal(base).toUpperCase()}\n${separator}\n${specs}`;
}

export function normalizePort(value, suffix) {
  const port = trimmed(value);
  const portSuffix = trimmed(suffix);
  if (!port) return '';
  if (!portSuffix) return port;

  const lowerPort = port.toLowerCase();
  const lowerSuffix = portSuffix.toLowerCase();

  if (lowerPort.endsWith(', ' + lowerSuffix) || lowerPort.endsWith(lowerSuffix)) {
    return port;
  }

  return `${port}, ${portSuffix}`;
}

export function freightFinal(currency, amount, terms) {
  return `${trimmed(currency)} ${trimmed(amount)} ${trimmed(terms)}`.trim();
}

export function demdetFinal(currency, amount) {
  return `${trimmed(currency)} ${trimmed(amount)} pdpr/fd`.trim();
}

export function commissionFinal(value) {
  const cleaned = trimmed(value);
  if (!cleaned) return '';
  if (cleaned.startsWith('%')) return `${cleaned} ttl commission`;
  return `%${cleaned} ttl commission`;
}

export function clauseLinesFromText(value) {
  return trimmed(value)
    .split(/\n+/)
    .map((line) => trimmed(line).replace(/^=\s*/, ''))
    .filter(Boolean);
}

export function getTermBehavior(term) {
  return TERM_BEHAVIOR[trimmed(term)] || {
    mode: 'laytime',
    meaning: `${trimmed(term)} selected.`,
    structure: 'Selected structure: day-based loading / discharging laytime fields.'
  };
}

export function isTextModeTerm(term) {
  return getTermBehavior(term).mode === 'text';
}

export function autoSubject(data) {
  const vessel = vesselFinal(data.vessel) || 'Core TBN';
  const pol = trimmed(data.pol) || 'POL';
  const pod = trimmed(data.pod) || 'POD';
  const laycan = trimmed(data.laycanDate) || 'Laycan TBA';
  return `${vessel} / ${pol} - ${pod} / ${laycan} / firm offer`;
}

export function buildSignature(data) {
  const parts = [
    trimmed(data.signOff),
    trimmed(data.senderName),
    trimmed(data.senderTitle),
    '',
    trimmed(data.companyName),
    trimmed(data.companyAddress),
    '',
    trimmed(data.senderMobile) ? `M: ${trimmed(data.senderMobile)}` : '',
    trimmed(data.senderDirect) ? `D: ${trimmed(data.senderDirect)}` : '',
    trimmed(data.senderEmail) ? `E-mail: ${trimmed(data.senderEmail)}` : '',
    trimmed(data.senderWeb)
  ];

  return parts
    .filter((part, index, arr) => part !== '' || (arr[index - 1] !== '' && arr[index + 1] !== undefined))
    .join('\n');
}

export function buildOfferText(data) {
  const isTextMode = isTextModeTerm(data.terms);
  const loadingFinal = isTextMode
    ? trimmed(data.fltLoadingText) || 'As fast as vessel can load'
    : `${trimmed(data.loadingDays)} days ${trimmed(data.loadingTerms)}`.trim();
  const dischargingFinal = isTextMode
    ? trimmed(data.fltDischargingText) || 'As fast as vessel can discharge'
    : `${trimmed(data.dischargingDays)} days ${trimmed(data.dischargingTerms)}`.trim();

  const lines = [
    `Vessel: ${vesselFinal(data.vessel)}`,
    `Account: ${trimmed(data.account)}`,
    `Cargo: ${trimmed(data.cargo)}`,
    `${trimmed(data.underDeck)}`,
    `${trimmed(data.cargoStackable)}`,
    `${trimmed(data.pcBasis || 'P/c basis')}`,
    `Lay/can: ${trimmed(data.laycanDate)}`,
    `POL: ${normalizePort(data.pol, data.terminalSuffix)}`,
    `POD: ${normalizePort(data.pod, data.terminalSuffix)}`,
    `Freight: ${freightFinal(data.currency, data.freightAmount, data.freightTerms)}`,
    `Terms: ${trimmed(data.terms)}`,
    `Dem/Det: ${demdetFinal(data.currency, data.demdetAmount)}`,
    `Loading: ${loadingFinal}`,
    `Discharging: ${dischargingFinal}`
  ];

  if (isTextMode && data.includeCongestion && trimmed(data.congestionClause)) {
    lines.push(trimmed(data.congestionClause));
  }

  lines.push(
    `Owners agents at load port: ${trimmed(data.agentLoad)}`,
    `Owners agents at discharge port: ${trimmed(data.agentDischarge)}`
  );

  const commission = commissionFinal(data.commissionPercentage);
  if (commission) {
    lines.push(commission);
  }

  if (trimmed(data.applicableContract)) {
    lines.push(trimmed(data.applicableContract));
  }

  const extraClauses = clauseLinesFromText(data.extraClauses);
  if (extraClauses.length) {
    lines.push(...extraClauses);
  }

  if (trimmed(data.finalClause)) {
    lines.push(trimmed(data.finalClause));
  }

  return lines.join('\n');
}

export function buildEmailText(data) {
  const subject = trimmed(data.emailSubject) || autoSubject(data);
  const offerText = buildOfferText(data);
  const vesselSpecs = data.includeVesselSpecs ? trimmed(data.vesselSpecs) : '';

  const blocks = [
    trimmed(data.greeting),
    '',
    trimmed(data.openingParagraph),
    '',
    trimmed(data.markerLine),
    vesselSpecs ? '' : '',
    vesselSpecs,
    vesselSpecs ? '' : '',
    trimmed(data.forLine),
    '',
    offerText,
    '',
    trimmed(data.endOfferLine),
    '',
    trimmed(data.closingParagraph),
    '',
    buildSignature(data)
  ];

  const cleaned = blocks.filter((part, index, arr) => {
    if (part !== '') return true;
    return arr[index - 1] !== '' && arr[index + 1] !== undefined && arr[index + 1] !== '';
  });

  return {
    subject,
    body: cleaned.join('\n')
  };
}

export function buildComputedOffer(data) {
  const isTextMode = isTextModeTerm(data.terms);
  const loadingFinal = isTextMode
    ? trimmed(data.fltLoadingText) || 'As fast as vessel can load'
    : `${trimmed(data.loadingDays)} days ${trimmed(data.loadingTerms)}`.trim();
  const dischargingFinal = isTextMode
    ? trimmed(data.fltDischargingText) || 'As fast as vessel can discharge'
    : `${trimmed(data.dischargingDays)} days ${trimmed(data.dischargingTerms)}`.trim();

  return {
    subject: trimmed(data.emailSubject) || autoSubject(data),
    vessel: vesselFinal(data.vessel),
    account: trimmed(data.account),
    cargo: trimmed(data.cargo),
    stowage: trimmed(data.underDeck),
    stackability: trimmed(data.cargoStackable),
    basis: trimmed(data.pcBasis || 'P/c basis'),
    laycan: trimmed(data.laycanDate),
    pol: normalizePort(data.pol, data.terminalSuffix),
    pod: normalizePort(data.pod, data.terminalSuffix),
    freight: freightFinal(data.currency, data.freightAmount, data.freightTerms),
    terms: trimmed(data.terms),
    demdet: demdetFinal(data.currency, data.demdetAmount),
    loading: loadingFinal,
    discharging: dischargingFinal,
    congestion: isTextMode && data.includeCongestion ? trimmed(data.congestionClause) : '',
    agentLoad: trimmed(data.agentLoad),
    agentDischarge: trimmed(data.agentDischarge),
    commission: commissionFinal(data.commissionPercentage),
    applicableContract: trimmed(data.applicableContract),
    extraClauses: clauseLinesFromText(data.extraClauses),
    finalClause: trimmed(data.finalClause),
    vesselSpecs: data.includeVesselSpecs ? trimmed(data.vesselSpecs) : '',
    markerLine: trimmed(data.markerLine),
    forLine: trimmed(data.forLine),
    greeting: trimmed(data.greeting),
    openingParagraph: trimmed(data.openingParagraph),
    endOfferLine: trimmed(data.endOfferLine),
    closingParagraph: trimmed(data.closingParagraph),
    signature: buildSignature(data)
  };
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToHtml(value) {
  return escapeHtml(trimmed(value)).replace(/\n/g, '<br />');
}

export function parseVesselSpecs(specsText) {
  const lines = trimmed(specsText)
    .split(/\n+/)
    .map((line) => trimmed(line))
    .filter(Boolean);

  let title = '';
  if (lines.length && !/^[-\s]+$/.test(lines[0])) {
    title = lines.shift();
  }
  if (lines.length && /^[-\s]+$/.test(lines[0])) {
    lines.shift();
  }

  return { title, lines };
}

function formatIntegerLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let normalized = raw;

  if (raw.includes('.') && raw.includes(',')) {
    normalized = raw.replace(/,/g, '');
  } else if (raw.includes('.')) {
    const parts = raw.split('.');
    normalized = parts[1] && parts[1].length <= 2 ? raw : raw.replace(/\./g, '');
  } else if (raw.includes(',')) {
    const parts = raw.split(',');
    normalized = parts[1] && parts[1].length <= 2 ? raw.replace(',', '.') : raw.replace(/,/g, '');
  }

  const numeric = Number.parseFloat(normalized);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric).toLocaleString('en-US');
  }

  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('en-US');
}

function normalizeBaseVesselName(value) {
  return trimmed(value).replace(/\s+or sub$/i, '');
}

function extractHoldHatchSummary(lines) {
  const joined = lines.join(' | ');
  let match = joined.match(/(\d+)\s*HOHA/i);
  if (match) return `${match[1]} Holds / ${match[1]} Hatches`;

  match = joined.match(/HO\/HA\s*(\d+)\s*\/\s*(\d+)/i);
  if (match) return `${match[1]} Holds / ${match[2]} Hatches`;

  match = joined.match(/(\d+)\s*HO\s*\/\s*(\d+)\s*HA/i);
  if (match) return `${match[1]} Holds / ${match[2]} Hatches`;

  match = joined.match(/(\d+)\s*HO\s*\/\s*HA\b/i);
  if (match) return `${match[1]} Holds / ${match[1]} Hatches`;

  match = joined.match(/(\d+)\s*HOLDS?\s*\/\s*(\d+)\s*HATCH(?:ES)?/i);
  if (match) return `${match[1]} Holds / ${match[2]} Hatches`;

  match = joined.match(/(\d+)\s*CARGO\s*HOLDS?/i);
  if (match) return `${match[1]} Cargo Holds`;

  return '';
}

function extractBoxSidSummary(lines) {
  const joined = lines.join(' | ');
  const parts = [];

  if (/FULLY\s+BOX/i.test(joined)) {
    parts.push('Fully Box');
  } else if (/BOX\s+SHAPED/i.test(joined)) {
    parts.push('Box Shaped');
  } else if (/\bBOX\b/i.test(joined)) {
    parts.push('Box');
  }

  if (/OPEN\s+HATCH/i.test(joined)) {
    parts.push('Open Hatch');
  }

  if (/\bSID\b/i.test(joined)) {
    parts.push('SID');
  }

  return parts.join(', ');
}

function extractGearSummary(lines) {
  const joined = lines.join(' | ');
  let match = joined.match(/GEARED\s*(\d+)\s*[x×]\s*(\d+(?:[\.,]\d+)?)\s*t/i);
  if (match) {
    return `Geared ${match[1]} × ${match[2].replace(',', '.')} t`;
  }

  match = joined.match(/(\d+)\s*CRANES?[^\d]*(\d+(?:[\.,]\d+)?)\s*MT/i);
  if (match) {
    return `Geared ${match[1]} × ${match[2].replace(',', '.')} t`;
  }

  if (/\bGEARLESS\b|\bGLESS\b/i.test(joined)) {
    return 'Gearless';
  }

  return '';
}

function extractCapacitySummary(lines) {
  let weight = '';
  let volume = '';
  let type = '';

  lines.forEach((line) => {
    if (!weight && /\b(DWCC|DWT|DWAT|DEADWEIGHT)\b/i.test(line)) {
      let match = line.match(/(\d[\d,\.]*)\s*\/\s*(\d[\d,\.]*)\s*DWAT\s*\/\s*DWCC/i);
      if (match) {
        weight = `${formatIntegerLike(match[2])} DWCC`;
      } else {
        match = line.match(/(?:DWCC(?:\s+SUMMER)?|DEADWEIGHT|DWT|DWAT)\s*(?:SUMMER\s*)?(\d[\d,\.]*)/i);
        if (!match) {
          match = line.match(/(\d[\d,\.]*)\s*(?:MTS\s+)?(?:DWT|DWAT|DWCC|MTS\s+DWT)\b/i);
        }
        if (match) {
          weight = `${formatIntegerLike(match[1])} DWCC`;
        }
      }
    }

    if (!volume && /\b(G\/B|GRAIN\s*CAPACITY|GRAIN\s*\/\s*BALE|GRAIN\s*BALE|GRAIN-BALE|GR-BL|\bGRAIN\b)\b/i.test(line)) {
      const match = line.match(/(\d[\d,\.]*)\s*(CBM|M3|CBFT|CUFT|M)\b/i)
        || line.match(/(?:G\/B|GRAIN\s*CAPACITY|GRAIN\s*\/\s*BALE|GRAIN\s*BALE|GRAIN-BALE|GR-BL|\bGRAIN\b)[^\d]*(\d[\d,\.]*)\s*(CBM|M3|CBFT|CUFT|M)\b/i);

      if (match) {
        const rawUnit = match[2].toUpperCase();
        const unit = rawUnit === 'M3' ? 'CBM' : rawUnit === 'M' ? 'M3' : rawUnit;
        volume = `${formatIntegerLike(match[1])} ${unit}`;
      }
    }
  });

  const joined = lines.join(' | ');
  if (/\bMPP\b/i.test(joined)) {
    type = 'MPP';
  } else if (/\bGENERAL\s+CARGO\b|\bG\/C\b/i.test(joined)) {
    type = 'General Cargo';
  }

  return { weight, volume, type };
}

function buildCompactVesselSpecs(specsText, fallbackTitle = '') {
  const parsed = parseVesselSpecs(specsText);
  const lines = parsed.lines || [];
  const title = normalizeBaseVesselName(parsed.title || fallbackTitle) || 'Vessel Particulars';

  const capacity = extractCapacitySummary(lines);
  const configLine = [extractHoldHatchSummary(lines), extractBoxSidSummary(lines)].filter(Boolean).join(', ');
  const gearLine = extractGearSummary(lines);

  const compactLines = [];
  const capacityLine = [capacity.weight, capacity.volume, capacity.type].filter(Boolean).join(' / ');
  if (capacityLine) compactLines.push(capacityLine);
  if (configLine) compactLines.push(configLine);
  if (gearLine) compactLines.push(gearLine);

  if (!compactLines.length) {
    compactLines.push(...lines.slice(0, 3));
  }

  return { title, lines: compactLines, rawLines: lines };
}

export function buildTermsRowsHtml(details) {
  const rows = [
    ['Vessel', details.vessel],
    ['Account', details.account],
    ['Cargo', details.cargo],
    ['Stowage', details.stowage],
    ['Stackability', details.stackability],
    ['Basis', details.basis],
    ['Lay/can', details.laycan],
    ['POL', details.pol],
    ['POD', details.pod],
    ['Freight', details.freight],
    ['Terms', details.terms],
    ['Dem/Det', details.demdet],
    ['Loading', details.loading],
    ['Discharging', details.discharging]
  ];

  if (details.congestion) {
    rows.push(['Congestion', details.congestion]);
  }

  rows.push(
    ['Owners agents at load port', details.agentLoad],
    ['Owners agents at discharge port', details.agentDischarge]
  );

  if (details.commission) {
    rows.push(['Commission', details.commission]);
  }

  if (details.applicableContract) {
    rows.push(['Applicable contract', details.applicableContract]);
  }

  return rows
    .filter(([, value]) => trimmed(value))
    .map(([label, value]) => `
                <tr>
                  <td width="29%" style="padding:11px 16px; border-bottom:1px solid #e2e8ef; background-color:#fafbfd; font-size:13px; font-weight:700; color:#334155; vertical-align:top;">${escapeHtml(label)}</td>
                  <td width="71%" style="padding:11px 16px; border-bottom:1px solid #e2e8ef; font-size:14px; line-height:1.6; color:#17314e;">${textToHtml(value)}</td>
                </tr>`)
    .join('');
}

export function buildHtmlEmailDocument(data) {
  const details = buildComputedOffer(data);
  const vesselSpecs = buildCompactVesselSpecs(details.vesselSpecs, details.vessel);

  const vesselSpecsSection = vesselSpecs.lines.length
    ? `
          <tr>
            <td style="padding:12px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate; border-spacing:0;">
                <tr>
                  <td style="padding:0;">
                    <div style="border:1px solid #cad5df; border-radius:14px; overflow:hidden; background:linear-gradient(180deg, #f7fafc 0%, #ffffff 100%); box-shadow:0 6px 18px rgba(15, 39, 66, 0.06);">
                      <div style="padding:14px 18px; background-color:#eef3f8; border-bottom:1px solid #d8e1ea;">
                        <div style="font-size:18px; font-weight:700; color:#0f2742;">${escapeHtml(vesselSpecs.title || 'Vessel Particulars')}</div>
                      </div>
                      <div style="padding:14px 18px; font-size:14px; line-height:1.7; color:#17314e;">
                        ${vesselSpecs.lines.map((line) => `<div style="margin:0 0 6px 0;">${textToHtml(line)}</div>`).join('')}
                      </div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const additionalClausesSection = (details.extraClauses.length || details.finalClause)
    ? `
          <tr>
            <td style="padding:12px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #cad5df; border-collapse:collapse;">
                <tr>
                  <td style="padding:14px 18px; background-color:#eef3f8; border-bottom:1px solid #cad5df;">
                    <div style="font-size:18px; font-weight:700; color:#0f2742;">Additional Clauses</div>
                  </td>
                </tr>
                ${(details.extraClauses || []).map((line) => `
                <tr>
                  <td style="padding:11px 18px; border-bottom:1px solid #e2e8ef; font-size:14px; line-height:1.6; color:#17314e;">${textToHtml(line)}</td>
                </tr>`).join('')}
                ${details.finalClause ? `
                <tr>
                  <td style="padding:11px 18px; font-size:14px; line-height:1.6; color:#17314e; font-weight:600;">${textToHtml(details.finalClause)}</td>
                </tr>` : ''}
              </table>
            </td>
          </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(details.subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f5f7; font-family:Arial, Helvetica, sans-serif; color:#1f2937;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f3f5f7; margin:0; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="760" style="width:760px; max-width:760px; background-color:#ffffff; border:1px solid #d9e0e7; border-collapse:collapse;">
          <tr>
            <td style="padding:28px 32px 20px 32px; background-color:#0f2742;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="color:#ffffff; font-size:24px; font-weight:700; letter-spacing:0.3px;">CORE SHIPPING</td>
                  <td align="right" style="color:#c8d5e3; font-size:12px; text-transform:uppercase; letter-spacing:1.2px;">Firm Offer</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:10px; color:#dbe5ef; font-size:13px; line-height:1.6;">
                    Subject: ${escapeHtml(details.subject)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 32px 8px 32px; font-size:15px; line-height:1.75; color:#17314e;">
              ${textToHtml(details.greeting)}<br><br>
              ${textToHtml(details.openingParagraph)}
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 0 32px; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#6b7c8f; font-weight:700;">
              ${escapeHtml(details.markerLine || '++')}
            </td>
          </tr>

          ${vesselSpecsSection}

          <tr>
            <td style="padding:12px 32px 0 32px;">
              <div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#6b7c8f; font-weight:700; padding:0 0 8px 2px;">
                ${escapeHtml(details.forLine || 'For')}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #cad5df; border-collapse:collapse;">
                <tr>
                  <td colspan="2" style="padding:14px 18px; background-color:#eef3f8; border-bottom:1px solid #cad5df;">
                    <div style="font-size:18px; font-weight:700; color:#0f2742;">Commercial Terms</div>
                  </td>
                </tr>
                ${buildTermsRowsHtml(details)}
              </table>
            </td>
          </tr>

          ${additionalClausesSection}

          <tr>
            <td style="padding:14px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-left:4px solid #0f2742; background-color:#f8fafc;">
                <tr>
                  <td style="padding:14px 16px; font-size:14px; line-height:1.7; color:#374151;">
                    <strong style="color:#0f2742;">${escapeHtml(details.endOfferLine || 'End offer')}</strong><br>
                    ${textToHtml(details.closingParagraph)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 32px 32px; font-size:14px; line-height:1.8; color:#17314e;">
              ${textToHtml(details.signature)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildMailtoUrl(data, options = {}) {
  const emailText = buildEmailText(data);
  const to = encodeURIComponent(trimmed(data.emailTo));
  const params = [];

  if (trimmed(data.emailCc)) {
    params.push(`cc=${encodeURIComponent(trimmed(data.emailCc))}`);
  }

  params.push(`subject=${encodeURIComponent(emailText.subject)}`);

  if (options.includeBody !== false) {
    params.push(`body=${encodeURIComponent(emailText.body)}`);
  }

  return `mailto:${to}${params.length ? `?${params.join('&')}` : ''}`;
}
