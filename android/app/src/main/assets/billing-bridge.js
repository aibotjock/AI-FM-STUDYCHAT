(function () {
  'use strict';
  if (window !== window.top || !window.FamilyMedicineAndroid || window.FMNativeBilling) return;
  window.FamilyMedicineAndroid.onmessage = function (event) {
    if (typeof event.data !== 'string' || event.data.length > 65536) return;
    try {
      var detail = JSON.parse(event.data);
      if (!detail || Array.isArray(detail) || typeof detail.type !== 'string') return;
      window.dispatchEvent(new CustomEvent('fm-native-billing', { detail: detail }));
    } catch (_) { /* Ignore malformed native messages without logging sensitive data. */ }
  };
  function send(action, params) {
    var payload = typeof params === 'string' ? JSON.parse(params) : (params || {});
    window.FamilyMedicineAndroid.postMessage(JSON.stringify({ action: action, payload: payload }));
  }
  Object.defineProperty(window, 'FMNativeBilling', {
    configurable: false, writable: false,
    value: Object.freeze({
      getProductDetails: function () { send('get-product-details'); },
      purchase: function (params) { send('purchase', params); },
      restore: function () { send('restore'); },
      manageSubscriptions: function () { send('manage-subscriptions'); }
    })
  });
  window.dispatchEvent(new CustomEvent('fm-native-billing', { detail: { type: 'native-ready' } }));
})();
