'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchPlayers, nameScore } = require('../tools/results-text/match.js');

test('names that differ the way names do between two lists are the same person; different people are not', () => {
  const same = [['Omar Fayoumy', 'Omar Elfayoumy'], ['Omar Fayoumi', 'omar elfayoumy'], ['Mohamed Aldoub', 'Mohammad Aldoub'], ['Damian-Alexandru Cucu', 'Damian Cucu'], ['Yousef Abualsamh', 'Yousef Abu Alsamh'],
    ['Roula Al Johani', 'Roula Aljohani'], ['Yousuf Toonsi', 'Yusuf Tunsi'], ['Emiliano Peraza Sandoval', 'Emiliano Peraza'], ['Alex Smith', 'Alexander Smith'], ['Diaz Bruno', 'Bruno Diaz'], ['Carla R', 'Carla Ruiz'],
    ['Ana Lopez', 'Ana López'], ['Angel Castro', 'Angel Castro Lopez'], ['Ana Lopes', 'Ana Lopez'], ['Ramy Boshra', 'Rami Bushra'], ['Mahdi Baqer', 'Mehdi Bagher'], ['Khaled Alshihab', 'Khalid Al Shehab'],
    ['Naif Almaousherji', 'Nayef Al Mousharji'], ['Haitham Salam', 'Haytham Salem'], ['Moath Alyamani', 'Muath Al Yamani']];
  same.forEach(([a, b]) => { assert.ok(nameScore(a, b) >= 80, a + ' ~ ' + b + ': ' + nameScore(a, b)); assert.equal(nameScore(a, b), nameScore(b, a), 'the same both ways: ' + a); });
  const different = [['Mohamed Aldoub', 'Abdulaziz Aldoub'], ['Ana Lopez', 'Maria Lopez'], ['Omar Fayoumy', 'Omar Farouk'], ['Maria Garcia', 'Mario Garcia'], ['Ali Hassan', 'Ali Hussein'], ['Sara Lee', 'Sam Lee'],
    ['Maria Ruiz', 'Marta Ruiz'], ['Elena Cruz', 'Lena Cruz'], ['Zain', 'Zain Ahmed']];
  different.forEach(([a, b]) => assert.equal(nameScore(a, b), 0, a + ' / ' + b));
  assert.equal(nameScore('Ana López', 'ana lopez'), 100);
  assert.ok(nameScore('Carla R', 'Carla Ruiz') < nameScore('Carla Ruiz', 'Carla Maria Ruiz'), 'an initial is the weakest match');
});

const C = [
  { id: 1, name: 'Ana López', phone: '+14805550001' }, { id: 2, name: 'Bruno Diaz', phone: '+14805550002' }, { id: 3, name: 'Carla Maria Ruiz', phone: '+14805550003' },
  { id: 4, name: 'Damian Cucu', phone: '+10766088881', email: 'd@x.edu' }, { id: 5, name: 'John Smith', phone: '+14805550005' }, { id: 6, name: 'John Smith', phone: '+14805550006' },
  { id: 7, name: 'Omar Elfayoumy', phone: '+14805550007' }, { id: 8, name: 'Mohammad Aldoub', phone: '+14805550008' }, { id: 9, name: 'Abdulaziz Aldoub', phone: '+14805550009' },
  { id: 10, name: 'Sara Lee', phone: '+14805550010' }, { id: 11, name: 'Sara Lee', phone: '+14805550010' }, { id: 12, name: 'Noah Phone', phone: '', email: 'noah@x.com' }, { id: 13, name: 'Omar Farouk', phone: '+14805550013' },
  { id: 14, name: 'Yousef Toonsi', phone: '+14805550014' }, { id: 15, name: 'Yousuf Toonsi', phone: '+14805550015' }
];
test('one person with several accounts is still one person', () => {
  const cucu = [{ id: 1, name: 'Damian-Alexandru Cucu', phone: '', email: 'd@x.edu' }, { id: 2, name: 'Damian Cucu', phone: '+10766088881' }, { id: 3, name: 'Damian Cucu', phone: '' }];
  assert.deepEqual(matchPlayers(['Damian-Alexandru Cucu'], cucu).matched.map(m => [m.customer.id, m.how]), [[1, 'exact']], 'the account with exactly that name');
  assert.deepEqual(matchPlayers(['Damian A Cucu'], cucu.slice(1)).matched.map(m => m.customer.id), [2], 'of two alike, the one with a phone');
  assert.equal(matchPlayers(['Damian Cucu'], [{ id: 2, name: 'Damian Cucu', phone: '+10766088881' }, { id: 4, name: 'Damian Cucu', phone: '+14805550044' }]).matched.length, 0, 'two phones: not clear which');
});

test('each player gets the one customer that fits; two that fit about as well, or none, means skipped', () => {
  const out = matchPlayers(['ana lopez', 'Diaz Bruno', 'Carla Ruiz', 'Damian-Alexandru Cucu', 'John Smith', 'Omar Fayoumy', 'Mohamed Aldoub', 'Abdulaziz Aldoub', 'Sara Lee', 'Noah Phone', 'Zain', 'Nobody Here', 'Carla R', 'Yusuf Toonsi', 'Yousuf Toonsi'], C);
  assert.deepEqual(out.matched.map(m => [m.name, m.customer.id, m.how]), [
    ['ana lopez', 1, 'exact'], ['Diaz Bruno', 2, 'close: Bruno Diaz'], ['Carla Ruiz', 3, 'close: Carla Maria Ruiz'], ['Damian-Alexandru Cucu', 4, 'close: Damian Cucu'],
    ['Omar Fayoumy', 7, 'close: Omar Elfayoumy'], ['Mohamed Aldoub', 8, 'close: Mohammad Aldoub'], ['Abdulaziz Aldoub', 9, 'exact'], ['Sara Lee', 10, 'exact'], ['Noah Phone', 12, 'exact'], ['Yousuf Toonsi', 15, 'exact']]);
  assert.deepEqual(out.skipped, [
    { name: 'John Smith', why: '2 customers with a name like that: John Smith, John Smith' }, { name: 'Zain', why: 'only one name' }, { name: 'Nobody Here', why: 'no customer with a name like that' },
    { name: 'Carla R', why: 'same customer as Carla Ruiz' }, { name: 'Yusuf Toonsi', why: '2 customers with a name like that: Yousuf Toonsi, Yousef Toonsi' }]);
});
