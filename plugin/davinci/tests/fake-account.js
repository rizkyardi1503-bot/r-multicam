// Licensed stand-in for lib/account.js in the protocol and Lua tests (the real gate is tested in account-tests.cjs).
'use strict';
function allowAll() {
  return { session: null, restore: async () => ({}), ensureAllowed: async () => ({}), heartbeat: async () => null,
    status: () => ({ signedIn: true, email: 'test@example.com', canUse: true, label: 'Lifetime', detail: 'test', code: 'LIFETIME' }) };
}
module.exports = { allowAll };
