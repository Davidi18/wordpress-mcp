// elementor-tree.test.js
// Regression guard for the surgical tree primitives. Run: node --test
// Zero dependencies — Node's built-in test runner + assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findElementById,
  removeElementById,
  moveElementById,
  reorderChildren,
  findWidgets
} from './elementor-tree.js';

// A small tree: root has two sections; s1 has a column c1 with two widgets.
function sample() {
  return [
    {
      id: 's1', elType: 'section', settings: {}, elements: [
        {
          id: 'c1', elType: 'column', settings: {}, elements: [
            { id: 'w1', elType: 'widget', widgetType: 'heading', settings: { title: 'Hello World' }, elements: [] },
            { id: 'w2', elType: 'widget', widgetType: 'button', settings: { text: 'Click me' }, elements: [] }
          ]
        }
      ]
    },
    { id: 's2', elType: 'section', settings: {}, elements: [
      { id: 'c2', elType: 'column', settings: {}, elements: [
        { id: 'w3', elType: 'widget', widgetType: 'button', settings: { text: 'Buy now' }, elements: [] }
      ] }
    ] }
  ];
}

test('removeElementById removes a nested element and returns it', () => {
  const { tree, removed } = removeElementById(sample(), 'w2');
  assert.equal(removed.id, 'w2');
  assert.equal(findElementById(tree, 'w2'), null);
  // siblings intact
  assert.ok(findElementById(tree, 'w1'));
});

test('removeElementById reports null when id absent', () => {
  const { removed } = removeElementById(sample(), 'nope');
  assert.equal(removed, null);
});

test('moveElementById moves a widget into another column, preserving id', () => {
  const { tree, movedId } = moveElementById(sample(), 'w1', { parent_id: 'c2', position: 'end' });
  assert.equal(movedId, 'w1');
  // gone from c1, present under c2
  const c1 = findElementById(tree, 'c1');
  assert.deepEqual(c1.element.elements.map(e => e.id), ['w2']);
  const c2 = findElementById(tree, 'c2');
  assert.deepEqual(c2.element.elements.map(e => e.id), ['w3', 'w1']);
});

test('moveElementById with after_id places element as the right sibling', () => {
  const { tree, movedId } = moveElementById(sample(), 'w3', { after_id: 'w1' });
  assert.equal(movedId, 'w3');
  const c1 = findElementById(tree, 'c1');
  assert.deepEqual(c1.element.elements.map(e => e.id), ['w1', 'w3', 'w2']);
});

test('moveElementById refuses to move an element into its own subtree', () => {
  assert.throws(() => moveElementById(sample(), 's1', { parent_id: 'c1', position: 'end' }), /not found, or is inside/);
});

test('moveElementById returns movedId null when the element is absent', () => {
  const { movedId } = moveElementById(sample(), 'ghost', 'end');
  assert.equal(movedId, null);
});

test('reorderChildren reorders a column, omitted children appended in order', () => {
  // c1 has [w1, w2]; ask for [w2] -> w2 first, then w1
  const { tree, ok, order } = reorderChildren(sample(), 'c1', ['w2']);
  assert.equal(ok, true);
  assert.deepEqual(order, ['w2', 'w1']);
  assert.deepEqual(findElementById(tree, 'c1').element.elements.map(e => e.id), ['w2', 'w1']);
});

test('reorderChildren on root (parentId null) reorders top sections', () => {
  const { tree, order } = reorderChildren(sample(), null, ['s2', 's1']);
  assert.deepEqual(order, ['s2', 's1']);
  assert.deepEqual(tree.map(e => e.id), ['s2', 's1']);
});

test('reorderChildren ignores unknown ids and reports parent-not-found', () => {
  const good = reorderChildren(sample(), 'c1', ['zzz', 'w2']);
  assert.deepEqual(good.order, ['w2', 'w1']); // zzz ignored
  const bad = reorderChildren(sample(), 'no-parent', ['w1']);
  assert.equal(bad.ok, false);
});

test('findWidgets matches by widgetType and by text', () => {
  const buttons = findWidgets(sample(), { widget_type: 'button' });
  assert.deepEqual(buttons.map(m => m.id).sort(), ['w2', 'w3']);
  const byText = findWidgets(sample(), { text_contains: 'hello' });
  assert.deepEqual(byText.map(m => m.id), ['w1']);
  // ancestor chain is reported
  assert.deepEqual(byText[0].ancestors_ids, ['s1', 'c1']);
});
