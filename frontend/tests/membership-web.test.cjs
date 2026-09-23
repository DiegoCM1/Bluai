const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, URL, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(output, context);
  return context.exports;
}

test('app opens the website selected by its backend without creating a checkout', async () => {
  const requests = [];
  const opened = [];
  const service = load('app/subscription/_services/subscriptionService.ts', {
    'react-native': { Linking: { openURL: async url => opened.push(url) } },
    '../../../utils/config': { API_BASE_URL: 'https://staging.example.com' },
    '../../../utils/api': { authFetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ membership_url: 'https://dev.example.com/membresias' }) };
    } },
  });
  await service.openMembershipWebsite('safe');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://staging.example.com/api/v1/payments/web/config');
  assert.equal(requests[0].options, undefined);
  assert.equal(opened[0], 'https://dev.example.com/membresias?plan=safe');
  assert.equal(service.createCheckoutSession, undefined);
});

test('app rejects an unsafe membership URL', async () => {
  const service = load('app/subscription/_services/subscriptionService.ts', {
    'react-native': { Linking: { openURL: async () => assert.fail('must not open') } },
    '../../../utils/config': { API_BASE_URL: 'https://staging.example.com' },
    '../../../utils/api': { authFetch: async () => ({ ok: true, json: async () => ({ membership_url: 'http://unsafe.example.com' }) }) },
  });
  await assert.rejects(service.openMembershipWebsite('safe'));
});

test('only an active plan unlocks its corresponding entitlements', () => {
  const { canAccessFeature, getCurrentPlanSlug } = load('app/subscription/_utils/planAccess.ts');
  assert.equal(getCurrentPlanSlug({ planSlug: 'guard', status: 'inactive' }), 'free');
  assert.equal(canAccessFeature('free', 'family_management'), false);
  assert.equal(canAccessFeature('safe', 'family_management'), true);
  assert.equal(canAccessFeature('safe', 'critical_staff'), false);
  assert.equal(canAccessFeature('guard', 'critical_staff'), true);
});
