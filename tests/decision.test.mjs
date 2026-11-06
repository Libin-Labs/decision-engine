import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDecisionEngine, testDecisionScenarios } from '../dist/esm/index.js';

test('uses descending priority then declaration order and explains every rule', () => {
  const engine = createDecisionEngine([
    { id: 'default', when: { op: 'exists', path: 'user' }, value: 'generic' },
    {
      id: 'vip-first',
      priority: 5,
      when: { op: 'eq', path: 'user.tier', value: 'gold' },
      value: 'A',
    },
    {
      id: 'vip-second',
      priority: 5,
      when: { op: 'eq', path: 'user.tier', value: 'gold' },
      value: 'B',
    },
  ]);
  const result = engine.evaluate({ user: { tier: 'gold' } });
  assert.equal(result.ruleId, 'vip-first');
  assert.equal(result.value, 'A');
  assert.deepEqual(
    result.trace.map((entry) => [entry.ruleId, entry.matched]),
    [
      ['vip-first', true],
      ['vip-second', true],
      ['default', true],
    ],
  );
  assert.throws(() => testDecisionScenarios(engine, Array(1)), /holes/);
});

test('supports nested all, any, and not boolean rule graphs', () => {
  const engine = createDecisionEngine([
    {
      id: 'approve',
      when: {
        op: 'all',
        conditions: [
          { op: 'gte', path: 'amount', value: 100 },
          {
            op: 'any',
            conditions: [
              { op: 'eq', path: 'region', value: 'west' },
              { op: 'not', condition: { op: 'exists', path: 'blocked' } },
            ],
          },
        ],
      },
      value: { outcome: 'approved' },
    },
  ]);
  assert.equal(engine.evaluate({ amount: 125, region: 'east' }).ruleId, 'approve');
  assert.equal(engine.evaluate({ amount: 10, region: 'west' }).ruleId, undefined);
});

test('evaluates scalar membership, comparisons, contains, prefixes, and missing paths', () => {
  const engine = createDecisionEngine([
    { id: 'tier', when: { op: 'in', path: 'tier', value: ['gold', 'silver'] }, value: 1 },
    { id: 'age', when: { op: 'lt', path: 'age', value: 18 }, value: 2 },
    { id: 'tag', when: { op: 'contains', path: 'tags', value: 'early' }, value: 3 },
    { id: 'prefix', when: { op: 'startsWith', path: 'code', value: 'US-' }, value: 4 },
    { id: 'present', when: { op: 'exists', path: 'optional' }, value: 5 },
  ]);
  assert.equal(engine.evaluate({ tier: 'silver' }).ruleId, 'tier');
  assert.equal(engine.evaluate({ age: 17 }).ruleId, 'age');
  assert.equal(engine.evaluate({ tags: ['early'] }).ruleId, 'tag');
  assert.equal(engine.evaluate({ code: 'US-7' }).ruleId, 'prefix');
  assert.equal(engine.evaluate({ optional: null }).ruleId, 'present');
  assert.equal(engine.evaluate({}).trace[4].checks[0].matched, false);
});

test('uses own-property paths only and rejects prototype traversal', () => {
  const engine = createDecisionEngine([
    { id: 'safe', when: { op: 'exists', path: 'profile.admin' }, value: true },
  ]);
  assert.equal(engine.evaluate({}).ruleId, undefined);
  assert.throws(
    () =>
      createDecisionEngine([{ id: 'bad', when: { op: 'exists', path: '__proto__.x' }, value: 1 }]),
    /Unsafe/,
  );
  assert.throws(
    () => engine.evaluate(JSON.parse('{"__proto__":{"admin":true}}')),
    /Unsafe JSON key/,
  );
});

test('scenario testing reports deterministic expected rule matches', () => {
  const engine = createDecisionEngine([
    { id: 'large', when: { op: 'gt', path: 'amount', value: 100 }, value: 'large' },
  ]);
  assert.deepEqual(
    testDecisionScenarios(engine, [
      { id: 'yes', facts: { amount: 101 }, expectedRuleId: 'large' },
      { id: 'no', facts: { amount: 50 }, expectedRuleId: null },
      { id: 'wrong', facts: { amount: 0 }, expectedRuleId: 'large' },
    ]),
    [
      { id: 'yes', actualRuleId: 'large', passed: true },
      { id: 'no', actualRuleId: null, passed: true },
      { id: 'wrong', actualRuleId: null, passed: false },
    ],
  );
});

test('copies output data so consumer mutation does not alter later decisions', () => {
  const engine = createDecisionEngine([
    { id: 'copy', when: { op: 'exists', path: 'ok' }, value: { nested: ['safe'] } },
  ]);
  const first = engine.evaluate({ ok: true });
  first.value.nested[0] = 'changed';
  assert.deepEqual(engine.evaluate({ ok: true }).value, { nested: ['safe'] });
});

test('validates operators, paths, priorities, and configured rule/condition budgets', () => {
  assert.throws(() => createDecisionEngine(Array(1)), /holes/);
  assert.throws(
    () => createDecisionEngine([{ id: 'x', when: { op: 'mystery' }, value: 1 }]),
    /Unknown condition/,
  );
  assert.throws(
    () =>
      createDecisionEngine([{ id: 'x', when: { op: 'gt', path: 'age', value: '2' }, value: 1 }]),
    /finite number/,
  );
  assert.throws(
    () =>
      createDecisionEngine([
        { id: 'x', when: { op: 'eq', path: 'data', value: { x: 1 } }, value: 1 },
      ]),
    /JSON primitive/,
  );
  assert.throws(
    () => createDecisionEngine([{ id: 'x', when: { op: 'all', conditions: [] }, value: 1 }]),
    /at least one/,
  );
  assert.throws(
    () => createDecisionEngine([{ id: 'x', when: { op: 'exists', path: 'a..b' }, value: 1 }]),
    /Unsafe/,
  );
  assert.throws(
    () =>
      createDecisionEngine([
        { id: 'x', priority: 1.5, when: { op: 'exists', path: 'a' }, value: 1 },
      ]),
    /integer/,
  );
  assert.throws(
    () =>
      createDecisionEngine([{ id: 'x', when: { op: 'exists', path: 'a' }, value: 1 }], {
        maxRules: 0,
      }),
    /maxRules/,
  );
  assert.throws(
    () =>
      createDecisionEngine(
        [
          {
            id: 'x',
            when: { op: 'all', conditions: [{ op: 'exists', path: 'a' }] },
            value: 1,
          },
        ],
        { maxConditionNodes: 1 },
      ),
    /Conditions exceed/,
  );
});

test('rejects cyclic, non-JSON, oversized, and non-plain facts', () => {
  const engine = createDecisionEngine([]);
  const shallow = createDecisionEngine([], { maxDepth: 1 });
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => engine.evaluate(cyclic), /Cyclic/);
  assert.throws(() => engine.evaluate({ value: undefined }), /JSON/);
  assert.throws(() => engine.evaluate(new Date()), /plain JSON/);
  assert.throws(() => shallow.evaluate({ a: { b: { c: 1 } } }), /depth/);
});

test('CommonJS entry point evaluates static rules', () => {
  const api = createRequire(import.meta.url)('../dist/cjs/index.js');
  const result = api
    .createDecisionEngine([
      { id: 'yes', when: { op: 'eq', path: 'flag', value: true }, value: 'yes' },
    ])
    .evaluate({ flag: true });
  assert.equal(result.value, 'yes');
});
