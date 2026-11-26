import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deepestNavigationRoute } from '@/globals/utils/navigation';
test('dashboard is exact and the deepest destination wins without partial segment matches', () => {
 const routes=['/class','/class/admin','/class/admin/classes','/class/admin/catalog'];
 assert.equal(deepestNavigationRoute('/class',routes),'/class');
 assert.equal(deepestNavigationRoute('/class/admin/classes/a/settings',routes),'/class/admin/classes');
 assert.equal(deepestNavigationRoute('/class/classes',routes),undefined);
 assert.equal(deepestNavigationRoute('/class/admin/catalogue',routes),'/class/admin');
 assert.equal(deepestNavigationRoute('/reports/events/a',['/reports','/reports/events']),'/reports/events');
});
