export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type DecisionCondition =
  | { op: 'all'; conditions: readonly DecisionCondition[] }
  | { op: 'any'; conditions: readonly DecisionCondition[] }
  | { op: 'not'; condition: DecisionCondition }
  | { op: 'eq' | 'neq'; path: string; value: JsonPrimitive }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; path: string; value: number }
  | { op: 'in'; path: string; value: readonly JsonPrimitive[] }
  | { op: 'contains'; path: string; value: JsonPrimitive }
  | { op: 'startsWith'; path: string; value: string }
  | {
      op: 'exists';
      path: string;
      value?: boolean;
    };

export interface DecisionRule {
  id: string;
  when: DecisionCondition;
  value: JsonValue;
  priority?: number;
}

export interface DecisionLimits {
  maxRules?: number;
  maxConditionNodes?: number;
  maxFactNodes?: number;
  maxDepth?: number;
}

export interface DecisionCheck {
  path: string;
  op: DecisionCondition['op'];
  matched: boolean;
}

export interface DecisionRuleTrace {
  ruleId: string;
  matched: boolean;
  checks: readonly DecisionCheck[];
}

export interface DecisionResult {
  ruleId?: string;
  value?: JsonValue;
  trace: readonly DecisionRuleTrace[];
}

export interface DecisionScenario {
  id: string;
  facts: unknown;
  expectedRuleId: string | null;
}

export interface DecisionScenarioResult {
  id: string;
  passed: boolean;
  actualRuleId: string | null;
}

export interface DecisionEngine {
  evaluate(facts: unknown): DecisionResult;
}

const DEFAULT_LIMITS: Required<DecisionLimits> = {
  maxRules: 1000,
  maxConditionNodes: 10_000,
  maxFactNodes: 20_000,
  maxDepth: 64,
};
const BLOCKED_PATHS = new Set(['__proto__', 'prototype', 'constructor']);

function boundedInteger(value: number, name: string, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}.`);
  }
}

function validId(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new TypeError(`${name} must be a nonempty string up to 128 characters.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value: unknown, maxNodes: number, maxDepth: number): JsonValue {
  let nodes = 0;
  const ancestors = new Set<object>();
  const copy = (current: unknown, depth: number): JsonValue => {
    nodes++;
    if (nodes > maxNodes) throw new RangeError(`JSON value exceeds ${maxNodes} nodes.`);
    if (depth > maxDepth) throw new RangeError(`JSON value exceeds depth ${maxDepth}.`);
    if (current === null || typeof current === 'string' || typeof current === 'boolean')
      return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current !== 'object') throw new TypeError('Values must be finite JSON data.');
    if (ancestors.has(current)) throw new TypeError('Cyclic values are not supported.');
    ancestors.add(current);
    let result: JsonValue;
    if (Array.isArray(current)) {
      const values: JsonValue[] = [];
      for (let index = 0; index < current.length; index++) {
        if (!Object.hasOwn(current, index))
          throw new TypeError('Sparse JSON arrays are not supported.');
        values.push(copy(current[index], depth + 1));
      }
      result = values;
    } else {
      if (!isRecord(current)) throw new TypeError('Only plain JSON records are supported.');
      const record: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(current)) {
        if (BLOCKED_PATHS.has(key)) throw new TypeError(`Unsafe JSON key: ${key}`);
        record[key] = copy(item, depth + 1);
      }
      result = record;
    }
    ancestors.delete(current);
    return result;
  };
  return copy(value, 0);
}

function validatePath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 256) {
    throw new TypeError('Condition path must be a nonempty string up to 256 characters.');
  }
  const parts = path.split('.');
  if (parts.some((part) => !part || BLOCKED_PATHS.has(part))) {
    throw new TypeError(`Unsafe or empty condition path: ${path}`);
  }
}

function validateCondition(condition: unknown, count: { value: number }, maxNodes: number): void {
  count.value++;
  if (count.value > maxNodes) throw new RangeError(`Conditions exceed ${maxNodes} nodes.`);
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw new TypeError('Each condition must be an object.');
  }
  const current = condition as Record<string, unknown>;
  if (current.op === 'all' || current.op === 'any') {
    if (!Array.isArray(current.conditions) || current.conditions.length === 0) {
      throw new TypeError(`${current.op} requires at least one condition.`);
    }
    for (const nested of current.conditions) validateCondition(nested, count, maxNodes);
    return;
  }
  if (current.op === 'not') {
    validateCondition(current.condition, count, maxNodes);
    return;
  }
  if (
    current.op !== 'eq' &&
    current.op !== 'neq' &&
    current.op !== 'gt' &&
    current.op !== 'gte' &&
    current.op !== 'lt' &&
    current.op !== 'lte' &&
    current.op !== 'in' &&
    current.op !== 'contains' &&
    current.op !== 'startsWith' &&
    current.op !== 'exists'
  ) {
    throw new TypeError(`Unknown condition operator: ${String(current.op)}`);
  }
  validatePath(current.path);
  if (current.op === 'exists') {
    if (current.value !== undefined && typeof current.value !== 'boolean') {
      throw new TypeError('exists.value must be boolean when provided.');
    }
  } else {
    const expected = cloneJson(current.value, maxNodes, DEFAULT_LIMITS.maxDepth);
    if (current.op === 'in' && !Array.isArray(expected)) {
      throw new TypeError('in.value must be an array of JSON primitives.');
    }
    if (
      current.op === 'in' &&
      (expected as readonly JsonValue[]).some(
        (value) => value !== null && typeof value === 'object',
      )
    ) {
      throw new TypeError('in.value must contain only JSON primitives.');
    }
    if (
      ['eq', 'neq', 'contains'].includes(current.op) &&
      expected !== null &&
      typeof expected === 'object'
    ) {
      throw new TypeError(`${current.op}.value must be a JSON primitive.`);
    }
    if (
      ['gt', 'gte', 'lt', 'lte'].includes(current.op) &&
      (typeof expected !== 'number' || !Number.isFinite(expected))
    ) {
      throw new TypeError(`${current.op}.value must be a finite number.`);
    }
    if (current.op === 'startsWith' && typeof expected !== 'string') {
      throw new TypeError('startsWith.value must be a string.');
    }
  }
}

function getPath(facts: unknown, path: string): { exists: boolean; value: unknown } {
  let current = facts;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment))
      return { exists: false, value: undefined };
    current = current[segment];
  }
  return { exists: true, value: current };
}

function evaluateCondition(
  condition: DecisionCondition,
  facts: unknown,
  checks: DecisionCheck[],
): boolean {
  if (condition.op === 'all') {
    const outcomes = condition.conditions.map((nested) => evaluateCondition(nested, facts, checks));
    return outcomes.every(Boolean);
  }
  if (condition.op === 'any') {
    const outcomes = condition.conditions.map((nested) => evaluateCondition(nested, facts, checks));
    return outcomes.some(Boolean);
  }
  if (condition.op === 'not') return !evaluateCondition(condition.condition, facts, checks);
  const current = getPath(facts, condition.path);
  let matched: boolean;
  if (condition.op === 'exists') {
    matched = current.exists === (condition.value ?? true);
  } else if (condition.op === 'eq' || condition.op === 'neq') {
    matched = current.exists && Object.is(current.value, condition.value);
    if (condition.op === 'neq') matched = !matched;
  } else if (condition.op === 'in') {
    matched =
      current.exists &&
      (condition.value as readonly JsonPrimitive[]).some((item) => Object.is(current.value, item));
  } else if (condition.op === 'contains') {
    matched =
      current.exists &&
      (typeof current.value === 'string'
        ? typeof condition.value === 'string' && current.value.includes(condition.value)
        : Array.isArray(current.value) && current.value.includes(condition.value));
  } else if (condition.op === 'startsWith') {
    matched =
      current.exists &&
      typeof current.value === 'string' &&
      current.value.startsWith(condition.value as string);
  } else {
    const actual = current.value;
    const expected = condition.value as number;
    matched =
      current.exists &&
      typeof actual === 'number' &&
      (condition.op === 'gt'
        ? actual > expected
        : condition.op === 'gte'
          ? actual >= expected
          : condition.op === 'lt'
            ? actual < expected
            : actual <= expected);
  }
  checks.push({ path: condition.path, op: condition.op, matched });
  return matched;
}

export function createDecisionEngine(
  input: readonly DecisionRule[],
  options: DecisionLimits = {},
): DecisionEngine {
  const limits = { ...DEFAULT_LIMITS, ...options };
  boundedInteger(limits.maxRules, 'maxRules', 10_000);
  boundedInteger(limits.maxConditionNodes, 'maxConditionNodes', 100_000);
  boundedInteger(limits.maxFactNodes, 'maxFactNodes', 100_000);
  boundedInteger(limits.maxDepth, 'maxDepth', 256);
  if (!Array.isArray(input) || input.length > limits.maxRules) {
    throw new RangeError(`Rules exceed the configured limit of ${limits.maxRules}.`);
  }
  const seen = new Set<string>();
  const count = { value: 0 };
  for (let index = 0; index < input.length; index++) {
    if (!Object.hasOwn(input, index)) throw new TypeError('Rule list cannot contain holes.');
  }
  const rules = input.map((rule, index) => {
    if (!rule || typeof rule !== 'object')
      throw new TypeError('Each decision rule must be an object.');
    validId(rule.id, 'Rule ID');
    if (seen.has(rule.id)) throw new TypeError(`Duplicate decision rule ID: ${rule.id}`);
    seen.add(rule.id);
    const priority = rule.priority ?? 0;
    if (!Number.isSafeInteger(priority))
      throw new TypeError(`Rule ${rule.id} priority must be an integer.`);
    validateCondition(rule.when, count, limits.maxConditionNodes);
    return {
      id: rule.id,
      when: rule.when,
      value: cloneJson(rule.value, limits.maxFactNodes, limits.maxDepth),
      priority,
      index,
    };
  });
  rules.sort((first, second) => second.priority - first.priority || first.index - second.index);
  return {
    evaluate(facts) {
      const safeFacts = cloneJson(facts, limits.maxFactNodes, limits.maxDepth);
      const trace = rules.map((rule) => {
        const checks: DecisionCheck[] = [];
        const matched = evaluateCondition(rule.when, safeFacts, checks);
        return { ruleId: rule.id, matched, checks };
      });
      const winner = trace.find((entry) => entry.matched);
      const rule = winner ? rules.find((candidate) => candidate.id === winner.ruleId) : undefined;
      return {
        ...(winner && rule
          ? {
              ruleId: winner.ruleId,
              value: cloneJson(rule.value, limits.maxFactNodes, limits.maxDepth),
            }
          : {}),
        trace,
      };
    },
  };
}

export function testDecisionScenarios(
  engine: DecisionEngine,
  scenarios: readonly DecisionScenario[],
): DecisionScenarioResult[] {
  if (!engine || typeof engine.evaluate !== 'function')
    throw new TypeError('Expected a decision engine.');
  if (!Array.isArray(scenarios) || scenarios.length > 1000) {
    throw new RangeError('Scenarios must be an array of at most 1000 entries.');
  }
  const ids = new Set<string>();
  for (let index = 0; index < scenarios.length; index++) {
    if (!Object.hasOwn(scenarios, index))
      throw new TypeError('Scenario list cannot contain holes.');
  }
  return scenarios.map((scenario) => {
    if (!scenario || typeof scenario !== 'object')
      throw new TypeError('Each scenario must be an object.');
    validId(scenario.id, 'Scenario ID');
    if (ids.has(scenario.id)) throw new TypeError(`Duplicate scenario ID: ${scenario.id}`);
    ids.add(scenario.id);
    if (scenario.expectedRuleId !== null) validId(scenario.expectedRuleId, 'Expected rule ID');
    const actualRuleId = engine.evaluate(scenario.facts).ruleId ?? null;
    return { id: scenario.id, actualRuleId, passed: actualRuleId === scenario.expectedRuleId };
  });
}
