'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchPlayers } = require('../tools/results-text/match.js');

const C = [
  { id: 1, name: 'Ana López', phone: '+14805550001' }, { id: 2, name: 'Bruno Diaz', phone: '(480) 555-0002' }, { id: 3, name: 'Carla Maria Ruiz', phone: '4805550003' },
  { id: 4, name: 'Damian-Alexandru Cucu', phone: '4805550004' }, { id: 5, name: 'John Smith', phone: '4805550005' }, { id: 6, name: 'John Smith', phone: '4805550006' },
  { id: 7, name: 'Emiliano Peraza Sandoval', phone: '4805550007' }, { id: 8, name: 'Mohammed Fakhroo', phone: '4805550008' }, { id: 9, name: 'Mohamed Aldoub', phone: '4805550009' },
  { id: 10, name: 'Sara Lee', phone: '4805550010' }, { id: 11, name: 'Sara Lee', phone: '+1 480 555 0010' }, { id: 12, name: 'Noah Phone', phone: '' }, { id: 13, name: 'Yousef Abualsamh', phone: '4805550013' }
];
test('exact and close-enough names are matched; unclear ones are skipped with a reason', () => {
  const out = matchPlayers(['ana lopez', 'Diaz Bruno', 'Carla Ruiz', 'Damian Alexandru Cucu', 'John Smith', 'Emiliano Peraza', 'Mohamed Fakhroo', 'Sara Lee', 'Noah Phone', 'Yousef Abualsamah', 'Zain', 'Nobody Here', 'Carla R'], C);
  assert.deepEqual(out.matched.map(m => [m.name, m.customer.id, m.how]), [
    ['ana lopez', 1, 'exact'], ['Diaz Bruno', 2, 'close: Bruno Diaz'], ['Carla Ruiz', 3, 'close: Carla Maria Ruiz'], ['Damian Alexandru Cucu', 4, 'exact'],
    ['Emiliano Peraza', 7, 'close: Emiliano Peraza Sandoval'], ['Mohamed Fakhroo', 8, 'close: Mohammed Fakhroo'], ['Sara Lee', 10, 'exact'], ['Yousef Abualsamah', 13, 'close: Yousef Abualsamh']]);
  assert.deepEqual(out.skipped, [
    { name: 'John Smith', why: '2 customers with that name' }, { name: 'Noah Phone', why: 'no phone number on file' }, { name: 'Zain', why: 'only one name' },
    { name: 'Nobody Here', why: 'no customer with that name' }, { name: 'Carla R', why: 'same phone as Carla Ruiz' }]);
});
test('a different person with a similar name is not matched', () => {
  const out = matchPlayers(['Mohamed Aldoub', 'Abdulaziz Aldoub', 'Ana Lopes Garcia', 'Bruno Dias'], C);
  // (one letter out, "Dias" for "Diaz", is a typing slip and is matched; a different first name or an extra last name is not)
  assert.deepEqual(out.matched.map(m => [m.name, m.customer.id]), [['Mohamed Aldoub', 9], ['Bruno Dias', 2]]);
  assert.deepEqual(out.skipped.map(x => x.name), ['Abdulaziz Aldoub', 'Ana Lopes Garcia']);
});
