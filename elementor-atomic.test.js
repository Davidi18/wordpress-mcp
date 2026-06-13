// elementor-atomic.test.js
// Regression guard for the atomic (V4) format builders. Run: node --test
// Zero dependencies — uses Node's built-in test runner + assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { props, styles, factory, widgets, unwrap, isAtomicType } from './elementor-atomic.js';

test('props wrap values in the $$type envelope', () => {
  assert.deepEqual(props.string('hi'), { $$type: 'string', value: 'hi' });
  assert.deepEqual(props.size(24, 'px'), { $$type: 'size', value: { size: 24, unit: 'px' } });
  assert.equal(props.boolean(1).value, true);
  assert.deepEqual(props.classes(), { $$type: 'classes', value: [] });
});

test('link only emits isTargetBlank when true', () => {
  assert.equal(props.link('/x').value.isTargetBlank, undefined);
  assert.equal(props.link('/x', true).value.isTargetBlank.value, true);
  assert.equal(props.link('/x').value.destination.value, '/x');
  assert.equal(props.link('/x').value.tag.value, 'a');
});

test('html wraps content in html-v3 with empty children', () => {
  const h = props.html('Hello');
  assert.equal(h.$$type, 'html-v3');
  assert.equal(h.value.content.value, 'Hello');
  assert.deepEqual(h.value.children, []);
});

test('image nests typed id + url under src', () => {
  const img = props.image(12, 'http://x/y.png');
  assert.equal(img.value.src.id.value, 12);
  assert.equal(img.value.src.url.value, 'http://x/y.png');
});

test('atomic widget carries the V4 scaffold keys', () => {
  const h = widgets.heading({ title: 'Welcome', tag: 'h1' });
  assert.equal(h.elType, 'widget');
  assert.equal(h.widgetType, 'e-heading');
  assert.equal(h.settings.title.$$type, 'html-v3');
  assert.equal(h.settings.tag.value, 'h1');
  assert.equal(h.settings.classes.$$type, 'classes');
  assert.deepEqual(h.interactions, []);
  assert.deepEqual(h.editor_settings, []);
  assert.equal(typeof h.styles, 'object');
  assert.equal(h.version, '');
  assert.equal(h.id.length, 8);
});

test('per-widget settings keys match the spec', () => {
  assert.ok(widgets.paragraph({ content: 'x' }).settings.paragraph);
  assert.ok(widgets.button({ text: 'x' }).settings.text);
  assert.equal(widgets.svg({ svg_id: 5 }).settings.svg.value.src.id.value, 5);
  assert.equal(widgets.youtube({ video_url: 'http://y' }).settings.source.value, 'http://y');
  assert.equal(widgets.video({ video_url: 'http://v' }).settings.source.$$type, 'url');
  assert.equal(widgets.divider().widgetType, 'e-divider');
});

test('css_id becomes settings._cssid', () => {
  const b = widgets.button({ text: 'Go', css_id: 'cta' });
  assert.equal(b.settings._cssid.value, 'cta');
});

test('flexbox builds a local style class linked from settings.classes', () => {
  const fx = factory.createFlexbox(
    { tag: props.string('section') },
    [],
    { direction: 'column', align: 'center', gap: 16, padding: 80 }
  );
  assert.equal(fx.elType, 'e-flexbox');
  const cid = fx.settings.classes.value[0];
  assert.ok(cid && fx.styles[cid], 'class id present in styles map');
  const p = fx.styles[cid].variants[0].props;
  assert.equal(p['flex-direction'].value, 'column');
  assert.equal(p['align-items'].value, 'center');
  assert.equal(p['gap'].value.size, 16);
  assert.equal(p['padding-block-start'].value.size, 80);
  assert.equal(fx.styles[cid].variants[0].meta.breakpoint, 'desktop');
  assert.equal(fx.styles[cid].variants[0].meta.state, null);
});

test('div-block applies common props but not flex', () => {
  const d = factory.createDivBlock({}, [], { padding: 20, background_color: '#fff', gap: 99 });
  assert.equal(d.elType, 'e-div-block');
  const cid = d.settings.classes.value[0];
  const p = d.styles[cid].variants[0].props;
  assert.equal(p['padding-block-start'].value.size, 20);
  assert.equal(p['background-color'].value, '#fff');
  assert.equal(p['gap'], undefined, 'div-block ignores flex gap');
});

test('flexbox without style props gets no local class', () => {
  const fx = factory.createFlexbox({}, []);
  assert.deepEqual(fx.settings.classes.value, []);
  assert.deepEqual(fx.styles, {});
});

test('version threads through to the element', () => {
  const h = widgets.heading({ title: 'x', version: '3.31.5' });
  assert.equal(h.version, '3.31.5');
});

test('unwrap round-trips to plain readable values', () => {
  const h = widgets.heading({ title: 'Welcome', tag: 'h1', link: '/x' });
  const u = unwrap(h.settings);
  assert.equal(u.title, 'Welcome');
  assert.equal(u.tag, 'h1');
  assert.equal(u.link, '/x');
  assert.equal(u.classes.length, 0);
  assert.equal(unwrap(props.size(24, 'rem')), '24rem');
  assert.deepEqual(unwrap(props.image(7, 'u')), { id: 7, url: 'u' });
});

test('isAtomicType recognizes atomic vs classic', () => {
  assert.ok(isAtomicType('e-button'));
  assert.ok(isAtomicType('e-flexbox'));
  assert.ok(!isAtomicType('heading'));
  assert.ok(!isAtomicType('container'));
});
