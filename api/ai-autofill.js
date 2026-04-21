const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_AUTOFILL_MODEL || 'gpt-5-mini';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_AUTOFILL_MODEL || 'gemini-2.5-flash';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function normalizeFields(value) {
  const safe = value && typeof value === 'object' ? value : {};
  const output = {};
  [
    'account',
    'cargo',
    'laycanDate',
    'pol',
    'pod',
    'currency',
    'freightTerms',
    'freightAmount',
    'demdetAmount',
    'terms',
    'loadingDays',
    'loadingTerms',
    'dischargingDays',
    'dischargingTerms',
    'commissionPercentage',
    'agentLoad',
    'agentDischarge',
    'extraClauses'
  ].forEach((key) => {
    const candidate = safe[key];
    if (candidate === undefined || candidate === null) return;
    output[key] = String(candidate).trim();
  });

  return output;
}

function splitLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function looksLikeInstructionLine(line) {
  const upper = line.toUpperCase();
  return (
    /\b(PLS|PLEASE|REVERT|HESITATE|ASKING|NOT FOR CIRCULATION|BEST OWNERS FRT|GOOD DAY)\b/.test(upper)
    || line.length > 120
  );
}

function looksLikeAccountLine(line) {
  if (looksLikeInstructionLine(line)) return false;
  return /\b(AGENCY|SHIPPING|BROKER|CHARTER|LOGISTIC|MARINE|FORWARDING|OPERATOR|TRADING|LINES?|CO\.?|COMPANY)\b/i.test(line);
}

function extractAccountFallback(cargoOfferText) {
  const lines = splitLines(cargoOfferText);
  if (!lines.length) return '';

  const signatureSlice = lines.slice(-30);
  const fromEmailLine = signatureSlice.find((line) => /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line)) || '';
  const fromEmail = (fromEmailLine.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i) || [])[0] || '';

  const companyLine = signatureSlice.find((line) => looksLikeAccountLine(line));
  if (companyLine) return companyLine;

  if (fromEmail) {
    const domain = fromEmail.split('@')[1] || '';
    const stem = domain.split('.')[0] || '';
    if (stem) return stem.replace(/[-_]+/g, ' ');
  }

  return '';
}

function cleanAccountValue(value) {
  return String(value || '')
    .replace(/^account\s*[:\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBadAccount(value) {
  const account = cleanAccountValue(value);
  if (!account) return true;
  if (looksLikeInstructionLine(account)) return true;
  if (account.split(/\s+/).length > 12) return true;
  if (/[.!?].{20,}/.test(account)) return true;
  return false;
}

function postProcessFields(fields, cargoOfferText) {
  const next = { ...(fields || {}) };
  const cleanedAccount = cleanAccountValue(next.account);
  if (isBadAccount(cleanedAccount)) {
    next.account = extractAccountFallback(cargoOfferText);
  } else {
    next.account = cleanedAccount;
  }
  return next;
}

function buildPrompt(cargoOffer, currentForm) {
  return [
    'You are an expert dry cargo chartering assistant.',
    'Extract and infer best possible values for a firm offer generator form.',
    'Only return JSON with a "fields" object, no prose.',
    'Rules:',
    '- Keep unknown values empty strings.',
    '- account MUST be a short company/account name only (e.g., "SOMAMED Agency Tunisia"), never instruction sentences.',
    '- Use exact ports for pol/pod.',
    '- If quantity and load/discharge rates exist, estimate loadingDays/dischargingDays from max quantity.',
    '- Prefer existing currentForm defaults when source email has no better value.',
    '- Commission should be numeric only (e.g., 2.5).',
    '- Preserve shipping abbreviations like spot, shinc, pmt.',
    '',
    'Current form snapshot:',
    JSON.stringify(currentForm || {}, null, 2),
    '',
    'Cargo offer email:',
    cargoOffer
  ].join('\n');
}

async function callOpenAI(cargoOffer, currentForm, apiKey, model) {
  const prompt = buildPrompt(cargoOffer, currentForm);
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'firm_offer_autofill',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              fields: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  account: { type: 'string' },
                  cargo: { type: 'string' },
                  laycanDate: { type: 'string' },
                  pol: { type: 'string' },
                  pod: { type: 'string' },
                  currency: { type: 'string' },
                  freightTerms: { type: 'string' },
                  freightAmount: { type: 'string' },
                  demdetAmount: { type: 'string' },
                  terms: { type: 'string' },
                  loadingDays: { type: 'string' },
                  loadingTerms: { type: 'string' },
                  dischargingDays: { type: 'string' },
                  dischargingTerms: { type: 'string' },
                  commissionPercentage: { type: 'string' },
                  agentLoad: { type: 'string' },
                  agentDischarge: { type: 'string' },
                  extraClauses: { type: 'string' }
                },
                required: []
              }
            },
            required: ['fields']
          }
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'OpenAI request failed.');
  }

  const rawText = payload?.output_text || '{}';
  const parsed = JSON.parse(rawText);
  return postProcessFields(normalizeFields(parsed?.fields), cargoOffer);
}

async function callGemini(cargoOffer, currentForm, apiKey, model) {
  const prompt = buildPrompt(cargoOffer, currentForm);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            fields: {
              type: 'OBJECT',
              properties: {
                account: { type: 'STRING' },
                cargo: { type: 'STRING' },
                laycanDate: { type: 'STRING' },
                pol: { type: 'STRING' },
                pod: { type: 'STRING' },
                currency: { type: 'STRING' },
                freightTerms: { type: 'STRING' },
                freightAmount: { type: 'STRING' },
                demdetAmount: { type: 'STRING' },
                terms: { type: 'STRING' },
                loadingDays: { type: 'STRING' },
                loadingTerms: { type: 'STRING' },
                dischargingDays: { type: 'STRING' },
                dischargingTerms: { type: 'STRING' },
                commissionPercentage: { type: 'STRING' },
                agentLoad: { type: 'STRING' },
                agentDischarge: { type: 'STRING' },
                extraClauses: { type: 'STRING' }
              }
            }
          },
          required: ['fields']
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Gemini request failed.');
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('') || '{}';
  const parsed = JSON.parse(rawText);
  return postProcessFields(normalizeFields(parsed?.fields), cargoOffer);
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(request);
  } catch (_) {
    sendJson(response, 400, { ok: false, error: 'Body must be valid JSON.' });
    return;
  }

  const cargoOffer = String(body?.cargoOffer || '').trim();
  if (!cargoOffer) {
    sendJson(response, 400, { ok: false, error: 'cargoOffer is required.' });
    return;
  }

  const requestApiKey = String(body?.apiKey || '').trim();
  const provider = String(body?.provider || 'openai').trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai';
  const activeApiKey = requestApiKey || (provider === 'gemini' ? GEMINI_API_KEY : OPENAI_API_KEY);
  if (!activeApiKey) {
    sendJson(response, 503, {
      ok: false,
      error: provider === 'gemini'
        ? 'GEMINI_API_KEY is not configured. Add it in Vercel env, or paste Gemini API key in the Autofill panel.'
        : 'OPENAI_API_KEY is not configured. Add it in Vercel env, or paste API key in the Autofill panel.'
    });
    return;
  }

  const requestModel = String(body?.model || '').trim();
  const activeModel = requestModel || (provider === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL);

  try {
    const fields = provider === 'gemini'
      ? await callGemini(cargoOffer, body?.currentForm || {}, activeApiKey, activeModel)
      : await callOpenAI(cargoOffer, body?.currentForm || {}, activeApiKey, activeModel);
    sendJson(response, 200, { ok: true, fields });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: error.message || 'AI autofill failed.'
    });
  }
};
