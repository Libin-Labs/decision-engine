# @lp-labs/decision-engine

Evaluate bounded declarative rule graphs against JSON facts. Rule order is deterministic,
evaluation returns matched-rule traces, and scenarios can be checked without executing rule code.
Rules contain data only: there is no expression interpreter, dynamic code evaluation, or callback
execution.

## Install

```bash
npm install @lp-labs/decision-engine
```

Requires Node.js 18 or newer. ESM and CommonJS consumers receive their matching declarations.
ESM: `import { createDecisionEngine } from '@lp-labs/decision-engine'`. CommonJS:
`const { createDecisionEngine } = require('@lp-labs/decision-engine')`.

## Runnable quickstart

Save as `quickstart.mjs` in a project where the package is installed and run
`node quickstart.mjs`.

```js
import { createDecisionEngine, testDecisionScenarios } from '@lp-labs/decision-engine';

const engine = createDecisionEngine([
  {
    id: 'priority-review',
    priority: 10,
    when: {
      op: 'all',
      conditions: [
        { op: 'gte', path: 'order.total', value: 500 },
        { op: 'eq', path: 'customer.tier', value: 'new' },
      ],
    },
    value: { route: 'manual-review' },
  },
  {
    id: 'standard',
    when: { op: 'exists', path: 'order.id' },
    value: { route: 'standard' },
  },
]);

const result = engine.evaluate({ order: { id: 'o-1', total: 750 }, customer: { tier: 'new' } });
if (result.ruleId !== 'priority-review') throw new Error('Unexpected decision');
const checks = testDecisionScenarios(engine, [
  { id: 'known-order', facts: { order: { id: 'o-2' } }, expectedRuleId: 'standard' },
]);
if (!checks[0].passed) throw new Error('Scenario failed');
console.log(result.value, result.trace);
```

## Rules and evaluation

`createDecisionEngine(rules: readonly DecisionRule[], limits?: DecisionLimits): DecisionEngine`
copies rule outputs and creates an immutable-in-practice evaluator. Rule IDs are unique labels up to
128 characters. Optional integer priorities are sorted descending; ties keep original declaration
order. The evaluator checks **every** rule to provide a complete trace. `DecisionResult.ruleId` and
`value` refer to the first matched rule in that order; if none match, both are absent.

`DecisionCondition` supports:

- `{ op: 'all' | 'any', conditions }` and `{ op: 'not', condition }` boolean groups.
- `eq`/`neq` on JSON primitives; numeric `gt`, `gte`, `lt`, `lte`; `in` with a primitive array;
  `contains` on a string or array; `startsWith` on strings; and `exists` with optional boolean
  `value` (defaults to `true`).
- Dotted paths traverse own properties only. Empty segments and `__proto__`, `prototype`, and
  `constructor` are rejected. Numeric comparisons do not coerce values; equality uses `Object.is`.

Facts and decision values must be finite JSON data in plain records/arrays, with no cycles,
`undefined`, functions, class instances, or unsafe keys. Fact objects are copied before evaluation.
`DecisionResult.trace` gives each rule ID, its match result, and leaf checks with paths, operators,
and boolean outcomes.

`testDecisionScenarios(engine, scenarios)` evaluates up to 1000 unique scenario IDs and returns
`{ id, passed, actualRuleId }` for each expected rule ID (or `null` for no match). A failed scenario
is data in the result; invalid scenarios or facts throw.

## Limits and API reference

Default limits are 1000 rules, 10,000 condition nodes across rules, 20,000 JSON fact/value nodes,
and depth 64. `DecisionLimits` can tune these bounds up to 10,000 rules, 100,000 condition/fact
nodes, and depth 256. Rule outputs are cloned on return so consumer mutations do not alter later
evaluations. Evaluation work is bounded by the fact, rule, condition, and depth limits; a rule list
is not a business-rule language or a policy database.

Runtime exports: `createDecisionEngine` and `testDecisionScenarios`. Public types:
`JsonPrimitive`, `JsonValue`, `DecisionCondition`, `DecisionRule`, `DecisionLimits`, `DecisionCheck`,
`DecisionRuleTrace`, `DecisionResult`, `DecisionScenario`, `DecisionScenarioResult`, and
`DecisionEngine`. There are no runtime or peer dependencies.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
