import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseProject, findSprint, hours, labelStage, stageSwap, type Project } from '../src/board.js';

const sprints = [
  { id: 's2', title: 'Sprint 2', startDate: '2026-10-19', duration: 14 },
  { id: 's1', title: 'Sprint 1', startDate: '2026-10-05', duration: 14 },
  { id: 's4', title: 'Sprint 4', startDate: '2026-11-16', duration: 14 },
];

test('the current sprint runs from its first day to the day before the next one starts', () => {
  assert.equal(findSprint(sprints, 'current', '2026-10-04'), null);
  assert.equal(findSprint(sprints, 'current', '2026-10-05')?.title, 'Sprint 1');
  assert.equal(findSprint(sprints, 'current', '2026-10-18')?.title, 'Sprint 1');
  assert.equal(findSprint(sprints, 'current', '2026-10-19')?.title, 'Sprint 2');
  // A gap between sprints is in none of them; the next sprint is the one after it.
  assert.equal(findSprint(sprints, 'current', '2026-11-05'), null);
  assert.equal(findSprint(sprints, 'next', '2026-11-05')?.title, 'Sprint 4');
  assert.equal(findSprint(sprints, 'next', '2026-10-05')?.title, 'Sprint 2');
  assert.equal(findSprint(sprints, 'next', '2026-11-16'), null);
});

test('estimates are stored as hours to two decimals', () => {
  assert.equal(hours(270), 4.5);
  assert.equal(hours(50), 0.83);
  assert.equal(hours(0), 0);
});

test('only an open linked Project is chosen, and several need a number', () => {
  const project = (number: number, closed = false): Project => ({
    id: `P${number}`,
    number,
    title: `p${number}`,
    closed,
    fields: [],
  });
  assert.equal(chooseProject([]), null);
  assert.equal(chooseProject([project(1, true)]), null);
  assert.equal(chooseProject([project(1, true), project(2)])?.number, 2);
  assert.throws(() => chooseProject([project(2), project(3)]), /Several Projects/);
  assert.equal(chooseProject([project(2), project(3)], 3)?.number, 3);
  assert.throws(() => chooseProject([project(1, true)], 1), /not an open Project/);
});

test('a stage swap removes every other stage label, and the labels give the stage', () => {
  assert.deepEqual(stageSwap(['type:feature', 'stage:plan'], 'execute'), {
    remove: ['stage:plan'],
    add: 'stage:execute',
  });
  assert.deepEqual(stageSwap(['stage:execute'], 'execute'), { remove: [], add: null });
  assert.equal(labelStage(['type:feature', 'stage:review']), 'review');
  assert.equal(labelStage(['bug']), null);
  assert.throws(() => labelStage(['stage:plan', 'stage:brief']), /several stage labels/);
});
