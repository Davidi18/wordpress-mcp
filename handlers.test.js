import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from './tool-definitions/index.js';
import { TOOL_HANDLERS, NOT_HANDLED } from './handlers/index.js';
import { toolsetOf, TOOLSETS } from './toolsets.js';

// A wpReq that fails loudly: we only care whether the handler claims the tool,
// not what it does with WordPress.
const STOP = new Error('stop');
const ctx = {
  wpReq: async () => { throw STOP; },
  clientConfig: null,
  currentAuthHeader: 'Basic x',
  auditLog: { query: async () => { throw STOP; } }
};

test('every defined tool is claimed by the handler of its toolset', async () => {
  const unclaimed = [];
  for (const { name } of tools) {
    const handler = TOOL_HANDLERS[toolsetOf(name)];
    assert.ok(handler, `no handler for toolset of ${name}`);
    let result;
    try { result = await handler(name, {}, ctx); } catch { continue; } // threw => handled
    if (result === NOT_HANDLED) unclaimed.push(name);
  }
  assert.deepEqual(unclaimed, []);
});

test('handlers reject tools they do not own', async () => {
  for (const g of TOOLSETS) {
    assert.equal(await TOOL_HANDLERS[g]('definitely_not_a_tool', {}, ctx), NOT_HANDLED);
  }
});

test('tool names are unique', () => {
  const names = tools.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
});
