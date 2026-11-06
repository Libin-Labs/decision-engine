import { createDecisionEngine, type DecisionRule } from '@lp-labs/decision-engine';

const rules: DecisionRule[] = [{ id: 'yes', when: { op: 'exists', path: 'ok' }, value: true }];
const id: string | undefined = createDecisionEngine(rules).evaluate({ ok: true }).ruleId;
void id;
