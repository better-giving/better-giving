import { connect } from '@better-giving/form/connect';
import type { FormConfig } from '@better-giving/form/v1';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialSnapshot } from '../machine';
import { createReactPropTypes } from '../normalize';
import { AmountStep, type AmountStepProps } from './amount';

// the tray's row marks (`markRows` in ./amount.tsx), which the grid-line rules in
// packages/form/src/styles/parts.css rule the lattice from: `data-row-start` on the tile that opens
// each wrapped row, and `--_cols` on the tray, the first row's count.
//
// happy-dom lays nothing out and reports every `offsetTop` as 0, so the wrap is stubbed: a tile on
// the tray stands `PITCH` below the row before it every `perRow` tiles, the way a grid of that many
// columns flows.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PITCH = 48;
const wrap = { perRow: 3 };

function stubWrap(): void {
	vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
		this: HTMLElement
	) {
		const tray = this.parentElement;
		if (tray === null || !tray.classList.contains('tiles')) return 0;
		const at = [...tray.querySelectorAll(':scope > label')].indexOf(this);
		return at === -1 ? 0 : Math.floor(at / wrap.perRow) * PITCH;
	});
}

const CONFIG: FormConfig = {
	formId: 'ff000000-0000-4000-8000-000000000001',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_spec' }],
	currency: 'usd',
	suggestedAmountsMinor: [1000, 2500, 5000, 10000, 25000],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0, capMinor: 500 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Helping Hands',
	ein: '12-3456789',
	deductibilityStatement: 'Helping Hands is a 501(c)(3).'
};

function props(config: FormConfig, over: Partial<AmountStepProps> = {}): AmountStepProps {
	return {
		api: connect(initialSnapshot(config), () => {}, createReactPropTypes()),
		config,
		head: null,
		hidden: false,
		missing: [],
		amountProblem: '',
		refusal: '',
		entry: '',
		onEntry: () => {},
		onPreset: () => {},
		onOther: () => {},
		otherChosen: false,
		onNoteToggle: () => {},
		onTributeToggle: () => {},
		notifyOpen: false,
		onNotify: () => {},
		onContinue: () => {},
		submits: true,
		refs: {
			entry: createRef(),
			note: createRef(),
			honoree: createRef(),
			notifyName: createRef(),
			notifyEmail: createRef()
		},
		drawsProgram: false,
		...over
	};
}

let mounted: { root: Root; host: HTMLElement } | null = null;

function mount(step: AmountStepProps): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(<AmountStep {...step} />));
	mounted = { root, host };
	return host;
}

function redraw(step: AmountStepProps): void {
	act(() => mounted?.root.render(<AmountStep {...step} />));
}

afterEach(() => {
	if (mounted !== null) {
		const { root, host } = mounted;
		act(() => root.unmount());
		host.remove();
		mounted = null;
	}
	wrap.perRow = 3;
	vi.restoreAllMocks();
});

const trayOf = (host: HTMLElement) => host.querySelector<HTMLElement>('.tiles') as HTMLElement;

/** the index of every tile marked as opening a row, in tray order. */
const rowStarts = (host: HTMLElement) =>
	[...trayOf(host).querySelectorAll(':scope > label')].flatMap((tile, at) =>
		tile.hasAttribute('data-row-start') ? [at] : []
	);

describe('the amount tray’s row marks', () => {
	// five suggestions and Other are six tiles.
	it.each([
		[3, [0, 3], '3'],
		[4, [0, 4], '4'],
		[2, [0, 2, 4], '2'],
		[6, [0], '6']
	])('at %i a row marks tiles %j and writes %s columns', (perRow, starts, cols) => {
		wrap.perRow = perRow;
		stubWrap();
		const host = mount(props(CONFIG));

		expect(rowStarts(host)).toEqual(starts);
		expect(trayOf(host).style.getPropertyValue('--_cols')).toBe(cols);
	});

	it('moves the marks when a re-render finds the tray wrapped differently', () => {
		stubWrap();
		const host = mount(props(CONFIG));
		expect(rowStarts(host)).toEqual([0, 3]);

		wrap.perRow = 2;
		redraw(props(CONFIG));

		expect(rowStarts(host)).toEqual([0, 2, 4]);
		expect(trayOf(host).style.getPropertyValue('--_cols')).toBe('2');
	});

	it('re-reads the wrap on the next frame after the window resizes', async () => {
		stubWrap();
		const host = mount(props(CONFIG));

		wrap.perRow = 4;
		await act(async () => {
			window.dispatchEvent(new Event('resize'));
			await new Promise((done) => window.requestAnimationFrame(done));
		});

		expect(rowStarts(host)).toEqual([0, 4]);
		expect(trayOf(host).style.getPropertyValue('--_cols')).toBe('4');
	});

	it('keeps the marks and the columns once the amount is refused', () => {
		stubWrap();
		const host = mount(props(CONFIG));
		const before = {
			starts: rowStarts(host),
			cols: trayOf(host).style.getPropertyValue('--_cols')
		};

		redraw(
			props(CONFIG, { missing: ['amount'], amountProblem: 'Enter an amount', otherChosen: true })
		);

		expect(host.querySelector<HTMLElement>('#amount-problem')?.hidden).toBe(false);
		expect(rowStarts(host)).toEqual(before.starts);
		expect(trayOf(host).style.getPropertyValue('--_cols')).toBe(before.cols);
	});

	it('writes no column count on a tray with no tiles', () => {
		stubWrap();
		const host = mount(props({ ...CONFIG, suggestedAmountsMinor: [2500] }));

		expect(trayOf(host).classList.contains('bare')).toBe(true);
		expect(trayOf(host).style.getPropertyValue('--_cols')).toBe('');
	});
});
