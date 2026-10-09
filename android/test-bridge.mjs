import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const bridge = readFileSync(fileURLToPath(new URL('./app/src/main/assets/billing-bridge.js', import.meta.url)), 'utf8');
function context({ subframe = false, native = true } = {}) {
  const messages = [], events = [];
  const window = { dispatchEvent(event) { events.push(event); } };
  window.top = subframe ? {} : window;
  if (native) window.FamilyMedicineAndroid = { postMessage(message) { messages.push(JSON.parse(message)); } };
  const sandbox = vm.createContext({ window, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  return { window, messages, events, sandbox };
}

const top = context();
vm.runInContext(bridge, top.sandbox);
assert.equal(top.events[0].type, 'fm-native-billing');
assert.equal(top.events[0].detail.type, 'native-ready');
assert.equal(Object.isFrozen(top.window.FMNativeBilling), true);
top.window.FMNativeBilling.getProductDetails();
const purchase = { productId: 'family_medicine_monthly', offerToken: 'provider-token', accountId: 'a'.repeat(64) };
top.window.FMNativeBilling.purchase(JSON.stringify(purchase));
top.window.FMNativeBilling.restore();
top.window.FMNativeBilling.manageSubscriptions();
assert.deepEqual(top.messages, [
  { action: 'get-product-details', payload: {} },
  { action: 'purchase', payload: purchase },
  { action: 'restore', payload: {} },
  { action: 'manage-subscriptions', payload: {} },
]);
const instance = top.window.FMNativeBilling;
vm.runInContext(bridge, top.sandbox);
assert.equal(top.window.FMNativeBilling, instance, 'Repeated page callback must not replace the bridge');
assert.equal(top.events.length, 1);
assert.throws(() => top.window.FMNativeBilling.purchase('{invalid-json'));
assert.equal(top.messages.length, 4, 'Malformed purchase input must not reach native billing');
top.window.FamilyMedicineAndroid.onmessage({ data: JSON.stringify({ type: 'purchase', purchaseToken: 'temporary-sensitive-token', purchaseState: 'PURCHASED' }) });
assert.equal(top.events.at(-1).detail.purchaseToken, 'temporary-sensitive-token');
assert.equal(top.events.at(-1).detail.purchaseState, 'PURCHASED');
const eventCount = top.events.length;
for (const data of ['{invalid-json', '[]', '{}', 'null', '1', 1, 'x'.repeat(65537)]) {
  top.window.FamilyMedicineAndroid.onmessage({ data });
}
assert.equal(top.events.length, eventCount, 'Malformed or excessive native replies must be ignored');
for (const options of [{ subframe: true }, { native: false }]) {
  const target = context(options);
  vm.runInContext(bridge, target.sandbox);
  assert.equal(target.window.FMNativeBilling, undefined);
  assert.equal(target.messages.length, 0);
  assert.equal(target.events.length, 0);
}
console.log('Android JavaScript bridge contract checks passed. Native compile/device checks are separate.');
