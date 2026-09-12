import { describe, expect, it } from 'vitest';
import { readFormConfig } from './config';

// node pool: reading a value someone else fetched is pure, so every claim about untrusted JSON is
// assertable with an object literal and no network.

/** the shape `/api/v1/forms/:id/config` is contracted to answer with. */
const RESPONSE = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'apple_pay'],
	feeCoverage: 'optional',
	feeRules: { card: { percent: 0.029, fixedMinor: 30 } },
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

/** the response with one field replaced or removed. */
function withField(field: string, value: unknown): unknown {
	const body: Record<string, unknown> = { ...RESPONSE };
	if (value === undefined) delete body[field];
	else body[field] = value;
	return body;
}

describe('reading a usable response', () => {
	it('carries the contract through unchanged', () => {
		const config = readFormConfig(RESPONSE);

		expect(config).toEqual(RESPONSE);
	});

	it('carries a form pinned to one cause through as the name a donor reads', () => {
		// the pin is the server's to write onto the gift, so what the wire carries is words for the
		// screen and nothing a request is built from.
		const config = readFormConfig(withField('program', { mode: 'pinned', name: 'Clean water' }));

		expect(config?.program).toEqual({ mode: 'pinned', name: 'Clean water' });
	});

	it('carries the causes a donor may choose between in the order the org set them', () => {
		const program = {
			mode: 'choice',
			options: [
				{ id: 'prg_water', name: 'Clean water' },
				{ id: 'prg_school', name: 'Schools' }
			]
		};

		expect(readFormConfig(withField('program', program))?.program).toEqual(program);
	});

	it('reads a form with no program at all as carrying none', () => {
		expect(readFormConfig(RESPONSE)).not.toHaveProperty('program');
	});

	it('keeps an optional field only when it is readable', () => {
		const config = readFormConfig({ ...RESPONSE, turnstileSiteKey: '0x4AAA' });

		expect(config?.turnstileSiteKey).toBe('0x4AAA');
		expect(readFormConfig(withField('turnstileSiteKey', '  '))).not.toHaveProperty(
			'turnstileSiteKey'
		);
	});
});

describe('a response the form cannot solicit a gift on', () => {
	// the identity a gift is asked for under is not decoration, and there is no safe reading of a
	// missing one. CLAUDE.md keeps these three required on the wire for the same reason.
	it.each(['orgLegalName', 'ein', 'deductibilityStatement'])(
		'refuses a config with no %s',
		(field) => {
			expect(readFormConfig(withField(field, undefined))).toBeNull();
		}
	);

	it.each(['formId', 'currency', 'providers'])('refuses a config with no %s', (field) => {
		expect(readFormConfig(withField(field, undefined))).toBeNull();
	});

	it.each(['minAmountMinor', 'maxAmountMinor'])('refuses a config with no %s', (field) => {
		// without both bounds no amount is ever complete, so the form would render and refuse
		// every gift with nothing on screen to say why.
		expect(readFormConfig(withField(field, undefined))).toBeNull();
	});

	it('refuses bounds that cross', () => {
		expect(readFormConfig({ ...RESPONSE, minAmountMinor: 900, maxAmountMinor: 800 })).toBeNull();
	});

	it('refuses a config offering no frequency it recognises', () => {
		expect(readFormConfig(withField('frequencies', ['fortnightly']))).toBeNull();
	});

	it('refuses a config offering no rail it recognises', () => {
		expect(readFormConfig(withField('paymentMethods', []))).toBeNull();
	});

	it('refuses a config whose only provider has no publishable key', () => {
		expect(readFormConfig(withField('providers', [{ name: 'stripe' }]))).toBeNull();
	});

	// a set with nothing in it names no processor, which is the same config as one with no field
	// at all: a form that collects a gift and has nothing to send it through.
	it('refuses a config naming no processor', () => {
		expect(readFormConfig(withField('providers', []))).toBeNull();
	});

	it('refuses a set that is not a list', () => {
		expect(
			readFormConfig(withField('providers', { name: 'stripe', publishableKey: 'pk_test_x' }))
		).toBeNull();
	});

	/**
	 * the two processors a deployment holds, kept in the order it named them.
	 *
	 * each adapter takes its own entry by `name` (`STRIPE_RAILS` and `PAYPAL_RAILS` in
	 * ./embed/rails.ts say which rails each draws), so the order is the deployment's own and this
	 * parse neither sorts it nor prefers one.
	 */
	it('carries every processor a deployment names', () => {
		const providers = [
			{ name: 'stripe', publishableKey: 'pk_test_x' },
			{ name: 'paypal', publishableKey: 'AZ_client_id' }
		];

		expect(readFormConfig(withField('providers', providers))?.providers).toEqual(providers);
	});

	// an entry nobody can initialise an SDK from is dropped rather than refusing the whole config:
	// the deployment's other processor still draws its own rails, which is the direction that keeps
	// a donation form on screen.
	it('drops an unreadable entry and keeps the processors it can read', () => {
		const config = readFormConfig(
			withField('providers', [{ name: 'paypal' }, { name: 'stripe', publishableKey: 'pk_test_x' }])
		);

		expect(config?.providers).toEqual([{ name: 'stripe', publishableKey: 'pk_test_x' }]);
	});

	// a program the response states and this file cannot read is not a field with a safe reading:
	// every reading available is a gift credited somewhere the org did not say, so the form does not
	// render at all rather than solicit one.
	it.each([
		['a mode it does not know', { mode: 'general', name: 'Clean water' }],
		['a pin with no name on it', { mode: 'pinned' }],
		['a choice whose options are not a list', { mode: 'choice', options: { id: 'prg_water' } }],
		['a cause with no id', { mode: 'choice', options: [{ name: 'Clean water' }] }],
		['a cause with no name', { mode: 'choice', options: [{ id: 'prg_water' }] }],
		['a program that is not an object', 'Clean water']
	])('refuses a program carrying %s', (_case, program) => {
		expect(readFormConfig(withField('program', program))).toBeNull();
	});

	it('refuses something that is not an object at all', () => {
		expect(readFormConfig('<!doctype html>')).toBeNull();
		expect(readFormConfig(null)).toBeNull();
		expect(readFormConfig([RESPONSE])).toBeNull();
	});

	it('refuses an empty string where a legal field was expected', () => {
		// an empty string is an absent field wearing a type, and it would render as a blank line
		// where the org's name belongs.
		expect(readFormConfig(withField('orgLegalName', '   '))).toBeNull();
	});
});

describe('a response with a safe reading', () => {
	it('reads a fee mode it does not recognise as the donor’s own decision', () => {
		// a word from a deployment newer than this snippet, or one retired from
		// `FEE_COVERAGE_MODES` in ./v1.ts. either way the donor gets the line and the choice, which
		// is the only mode the contract carries — never a silent no-fee reading, which would take
		// the decision away from them and quietly cost the org the fee.
		const config = readFormConfig(withField('feeCoverage', 'whatever'));

		expect(config?.feeCoverage).toBe('optional');
	});

	it('reads a missing fee mode the same way', () => {
		expect(readFormConfig(withField('feeCoverage', undefined))?.feeCoverage).toBe('optional');
	});

	it('keeps only the rails whose price it could read', () => {
		// ./v1.ts types `feeRules` as total over the rails and says the response need not be.
		// `estimateFee` takes `undefined` for exactly this, so a missing rail is a fee line that
		// does not render rather than a throw inside a state transition.
		const config = readFormConfig(
			withField('feeRules', {
				card: { percent: 0.029, fixedMinor: 30 },
				ach: { percent: 'free' },
				google_pay: { percent: -1, fixedMinor: 0 }
			})
		);

		expect(Object.keys(config?.feeRules ?? {})).toEqual(['card']);
	});

	it('carries a rail’s fee cap through', () => {
		// the bound is what keeps a bank-debit gift past $625 from quoting more than the $5.00
		// the processor takes, so dropping it silently would restore the over-collection on the
		// screen that asks for money — see `estimateFee` in ./fee.ts.
		const config = readFormConfig(
			withField('feeRules', { ach: { percent: 0.008, fixedMinor: 0, capMinor: 500 } })
		);

		expect(config?.feeRules.ach).toEqual({ percent: 0.008, fixedMinor: 0, capMinor: 500 });
	});

	it('leaves a rail priced without a cap uncapped rather than bounding it at zero', () => {
		// an absent bound is not a bound of nothing. defaulted to zero it would price every card
		// gift at the flat charge alone, which is a fee line under what the processor takes.
		const config = readFormConfig(
			withField('feeRules', { card: { percent: 0.029, fixedMinor: 30 } })
		);

		expect(config?.feeRules.card).toEqual({ percent: 0.029, fixedMinor: 30 });
		expect('capMinor' in (config?.feeRules.card ?? {})).toBe(false);
	});

	it('drops a rail whose cap is not a whole non-negative amount', () => {
		// a malformed bound is a malformed price, and it degrades the way every other one does:
		// the rail is dropped and no fee line renders for it. keeping the rule with the cap
		// stripped would quote the uncapped rate, which is the over-collection this field exists
		// to prevent, arrived at by discarding the field.
		const config = readFormConfig(
			withField('feeRules', {
				card: { percent: 0.029, fixedMinor: 30 },
				ach: { percent: 0.008, fixedMinor: 0, capMinor: 500.5 },
				apple_pay: { percent: 0.029, fixedMinor: 30, capMinor: -500 },
				google_pay: { percent: 0.029, fixedMinor: 30, capMinor: 'none' }
			})
		);

		expect(Object.keys(config?.feeRules ?? {})).toEqual(['card']);
	});

	it('reads a choice between no causes as no program at all', () => {
		// a select drawn over nothing is a question with no answers, and the gift goes where it is
		// needed most either way — which is what an absent program already means.
		expect(
			readFormConfig(withField('program', { mode: 'choice', options: [] }))
		).not.toHaveProperty('program');
	});

	it('reads an unusable locale as a formatting default', () => {
		expect(readFormConfig(withField('locale', 42))?.locale).toBe('en-US');
	});

	it('drops a suggested amount the form would refuse anyway', () => {
		// a tile the bounds check in ./value.ts cannot accept is a tile that does nothing when
		// pressed, which is worse than one fewer tile.
		const config = readFormConfig(
			withField('suggestedAmountsMinor', [100, 2500, 25.5, 'lots', 9_000_000])
		);

		expect(config?.suggestedAmountsMinor).toEqual([2500]);
	});

	it('accepts a form with no suggested amounts at all', () => {
		// the free amount entry is still there, so this is a usable form rather than a broken one.
		expect(
			readFormConfig(withField('suggestedAmountsMinor', undefined))?.suggestedAmountsMinor
		).toEqual([]);
	});

	it('orders the vocabularies by the contract rather than by the response', () => {
		// two deployments that enabled the same frequencies render them the same way round.
		const config = readFormConfig(withField('frequencies', ['yearly', 'one_time', 'monthly']));

		expect(config?.frequencies).toEqual(['one_time', 'monthly', 'yearly']);
	});

	it('ignores a member of a vocabulary it does not know', () => {
		const config = readFormConfig(withField('paymentMethods', ['card', 'crypto']));

		expect(config?.paymentMethods).toEqual(['card']);
	});
});
