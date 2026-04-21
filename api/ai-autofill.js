const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_AUTOFILL_MODEL || 'gpt-5-mini';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

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

function buildPrompt(cargoOffer, currentForm) {
  return [
    'You are an expert dry cargo chartering assistant.',
    'Extract and infer best possible values for a firm offer generator form.',
    'Only return JSON with a "fields" object, no prose.',
    'Rules:',
    '- Keep unknown values empty strings.',
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
  return normalizeFields(parsed?.fields);
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
  const activeApiKey = requestApiKey || OPENAI_API_KEY;
  if (!activeApiKey) {
    sendJson(response, 503, {
      ok: false,
      error: 'OPENAI_API_KEY is not configured. Add it in Vercel env, or paste API key in the Autofill panel.'
    });
    return;
  }

  const requestModel = String(body?.model || '').trim();
  const activeModel = requestModel || OPENAI_MODEL;

  try {
    const fields = await callOpenAI(cargoOffer, body?.currentForm || {}, activeApiKey, activeModel);
    sendJson(response, 200, { ok: true, fields });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: error.message || 'AI autofill failed.'
    });
  }
};
