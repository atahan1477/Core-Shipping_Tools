const crypto = require('node:crypto');

const dispatchStore = global.__coreShippingDispatchStore || [];
global.__coreShippingDispatchStore = dispatchStore;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.end(JSON.stringify(payload));
}

function safeTrim(value) {
  return String(value ?? '').trim();
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

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(request);
  } catch (_) {
    sendJson(response, 400, { ok: false, error: 'Request body must be valid JSON.' });
    return;
  }

  const mode = safeTrim(body.mode || 'send').toLowerCase();
  const now = new Date().toISOString();

  if (mode !== 'send' && mode !== 'correction') {
    sendJson(response, 400, { ok: false, error: 'mode must be send or correction.' });
    return;
  }

  const record = {
    id: `offer_${crypto.randomUUID()}`,
    messageId: `msg_${crypto.randomUUID()}`,
    mode,
    senderEmail: safeTrim(body.senderEmail),
    priorOfferId: safeTrim(body.priorOfferId),
    rfqSnapshot: body.rfqSnapshot || {},
    generatedTermsSnapshot: body.generatedTermsSnapshot || {},
    createdAt: now
  };

  if (mode === 'correction' && !record.priorOfferId) {
    sendJson(response, 400, { ok: false, error: 'Correction requires priorOfferId.' });
    return;
  }

  dispatchStore.push(record);

  sendJson(response, 200, {
    ok: true,
    record,
    crmLog: {
      persisted: true,
      attachments: ['rfqSnapshot', 'generatedTermsSnapshot'],
      count: dispatchStore.length
    }
  });
};
