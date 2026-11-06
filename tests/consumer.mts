import {
  createDecisionEngine,
  testDecisionScenarios,
  type DecisionCondition,
  type DecisionEngine,
  type DecisionLimits,
  type DecisionResult,
  type DecisionRule,
  type DecisionScenario,
  type DecisionScenarioResult,
  type JsonValue,
} from '@lp-labs/decision-engine';

const condition: DecisionCondition = { op: 'gte', path: 'score', value: 50 };
const rule: DecisionRule = { id: 'pass', when: condition, value: { ok: true } };
const limits: DecisionLimits = { maxRules: 20 };
const engine: DecisionEngine = createDecisionEngine([rule], limits);
const result: DecisionResult = engine.evaluate({ score: 90 });
const value: JsonValue | undefined = result.value;
const scenarios: DecisionScenario[] = [
  { id: 'pass', facts: { score: 90 }, expectedRuleId: 'pass' },
];
const scenarioResults: DecisionScenarioResult[] = testDecisionScenarios(engine, scenarios);
void value;
void scenarioResults;
