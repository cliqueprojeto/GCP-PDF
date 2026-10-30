import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels, probeModel, freeCandidates, paidCandidate, requestAnswer, FREE_TIER_BLOCKED } from '../src/main/ai';

const gemini = { provider: 'gemini' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('lists only text models the key can call, sending the key in the header', async () => {
  let seen: any;
  const models = await listModels(gemini, 'ficticia', (async (url: string, options: any) => { seen = { url, options }; return json({ models: [
    { name: 'models/modelo-flash', displayName: 'Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-x', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-x', displayName: 'Imagen', supportedGenerationMethods: ['generateContent'] },
  ] }); }) as typeof fetch);
  assert.deepEqual(models.map((m) => m.id), ['modelo-flash']);
  assert.equal(seen.options.headers['x-goog-api-key'], 'ficticia');
  assert.ok(!seen.url.includes('ficticia'));
});

test('a model with zero free quota is reported as such, not as "daily requests exhausted"', async () => {
  const body = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: modelo-pro' } };
  const probe = await probeModel({ ...gemini, model: 'modelo-pro' }, 'k', (async () => json(body, 429)) as typeof fetch);
  assert.deepEqual(probe, { ok: false, message: FREE_TIER_BLOCKED, freeTierBlocked: true });
  await assert.rejects(requestAnswer({ ...gemini, model: 'modelo-pro', hasKey: true }, 'k', 'Resuma', 'Texto.', (async () => json(body, 429)) as typeof fetch), (e: Error) => e.message === FREE_TIER_BLOCKED);
  const ok = await probeModel({ ...gemini, model: 'modelo-flash' }, 'k', (async () => json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })) as typeof fetch);
  assert.deepEqual(ok, { ok: true });
});

test('free-key search tries light, stable models first', () => {
  const order = freeCandidates(['modelo-pro', 'modelo-flash-preview', 'modelo-flash', 'modelo-flash-lite'].map((id) => ({ id, label: id }))).map((m) => m.id);
  assert.deepEqual(order, ['modelo-flash-lite', 'modelo-flash', 'modelo-pro', 'modelo-flash-preview']);
});

test('the billing check uses the most complete stable model, never a preview or a light one', () => {
  const pick = paidCandidate(['modelo-2.5-pro', 'modelo-3.0-pro-preview', 'modelo-3.0-pro', 'modelo-3.0-flash-lite', 'modelo-3.0-flash'].map((id) => ({ id, label: id })));
  assert.equal(pick?.id, 'modelo-3.0-pro');
  assert.equal(paidCandidate([{ id: 'modelo-flash', label: 'x' }]), undefined);
});
