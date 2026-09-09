import { describe, expect, it } from 'vitest';
import { OPENING_STAGE, REACHED, STAGES, STEP, SUBJECTS } from './stripe-run-lines';

// the mapping the payments fold reads the setup chain off, held to the properties tsc cannot see.
//
// stated lists rather than derived ones, so a regrouping is a line somebody changed on purpose.
// what tsc already holds is the covering — `REACHED` and `STEP` are both `Record<StripeStage, …>`,
// so a stage added to ../api/types.ts with no line and no sentence is a compile error rather than a
// case here. what it cannot see is where a stage was put.
//
// **the run is the property, not the arithmetic.** a line lights when the chain reaches its first
// stage and goes out when the chain leaves its last, so a line whose stages were not one unbroken
// run would light, go out, and light again — a ledger that goes backwards while the press goes
// forwards.
//
// this package has no DOM pool (../../vite.config.ts), so nothing here is a claim about what the fold
// draws. it is a claim about the values that fold draws from.

/** which line each stage falls under, as the ledger reads it: the subject's id and its stages. */
const grouped: [id: string, stages: string[]][] = SUBJECTS.map((subject, at) => [
	subject.id,
	STAGES.filter((stage) => REACHED[stage] === at)
]);

describe('the six steps under the four lines', () => {
	it('files every stage under a line the fold draws', () => {
		const lines = SUBJECTS.map((_, at) => at);
		expect(STAGES.map((stage) => REACHED[stage]).filter((at) => !lines.includes(at))).toEqual([]);
	});

	it('leaves no line with nothing under it', () => {
		// a line with no stage never lights, and a ledger that reports a subject the chain never
		// reaches is one an operator waits on to the end of the run.
		expect(grouped.filter(([, stages]) => stages.length === 0)).toEqual([]);
	});

	it('lights each line once, because its stages are one unbroken run', () => {
		const order = STAGES.map((stage) => REACHED[stage]);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('groups them the way the fold is written to read them', () => {
		// stated rather than derived, so a regrouping is a line somebody changed here on purpose.
		// the three steps that establish the errand between the two hosts stand under one line, and
		// the two the deployment makes itself stand last, one line each — they are two different
		// things being established, and a donor is shown the absence of each in a different place.
		expect(grouped).toEqual([
			['keys', ['naming']],
			['telling', ['registering', 'storing', 'publishing']],
			['repeating', ['repeating']],
			['wallets', ['covering']]
		]);
	});

	it('gives every stage something to say', () => {
		// tsc holds that a sentence exists; what it does not hold is that one says anything.
		expect(STAGES.filter((stage) => STEP[stage] === '')).toEqual([]);
	});

	it('opens on the stage the chain starts at', () => {
		// the chain reports `naming` before it does anything (`packages/console/internal/stripe`), so
		// a ledger whose first line were not that stage's would open with a line already behind the
		// run.
		expect(STAGES[0]).toBe('naming');
	});

	it('draws a press with no reading yet at that same stage', () => {
		// the card goes up on the press and the run's first reading arrives a revalidation later, so
		// what it draws in between is stated rather than read. a stage that had drifted from the
		// order above would open the card on a line the chain has already left.
		expect(OPENING_STAGE).toBe(STAGES[0]);
		expect(REACHED[OPENING_STAGE]).toBe(0);
	});
});
