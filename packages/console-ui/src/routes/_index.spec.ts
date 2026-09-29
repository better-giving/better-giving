import type { ClientActionFunctionArgs } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VarsWritten } from '../api/types';

// the presses `/` answers for the account panel, which posts here from over any page
// (../lib/close-confirm.tsx's `SHELL_ACTION`): which write each intent makes on the binary. the
// client is replaced so every write is a record of what it was sent.

const binary = vi.hoisted(() => ({
	written: [] as Record<string, string | null>[],
	freed: 0,
	closed: 0
}));

const SET: VarsWritten = { kind: 'set' };

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	setVars: async (values: Record<string, string | null>) => {
		binary.written.push(values);
		return SET;
	},
	freeWithheldVars: async () => {
		binary.freed += 1;
		return SET;
	},
	closeConsole: async () => {
		binary.closed += 1;
		return { closing: true };
	}
}));

const { PLAN_FIELD, PLAN_INTENT } = await import('../lib/cloudflare-plan');
const { SHELL_ACTION } = await import('../lib/close-confirm');
const { FREE_INTENT } = await import('../lib/withheld-values');
const home = await import('./_index');

const ORIGIN = 'http://localhost';

/** a post to `/` carrying `intent` and whatever else the case names. */
const press = (intent: string, fields: Record<string, string> = {}) => {
	const posted = new FormData();
	posted.set('intent', intent);
	for (const [name, value] of Object.entries(fields)) posted.set(name, value);
	return home.clientAction({
		request: new Request(new URL(SHELL_ACTION, ORIGIN), { method: 'POST', body: posted })
	} as unknown as ClientActionFunctionArgs);
};

beforeEach(() => {
	binary.written = [];
	binary.freed = 0;
	binary.closed = 0;
});

describe('the paid-plan switch', () => {
	it('stores the one word where the box is ticked', async () => {
		const answer = await press(PLAN_INTENT, { [PLAN_FIELD]: 'true' });

		expect(binary.written).toEqual([{ CLOUDFLARE_PAID_PLAN: 'true' }]);
		expect(answer).toEqual({ plan: SET });
	});

	it('takes the name off where the box is not ticked', async () => {
		await press(PLAN_INTENT);

		expect(binary.written).toEqual([{ CLOUDFLARE_PAID_PLAN: null }]);
	});
});

describe('the press that frees the withheld values', () => {
	it('frees them, and writes nothing else', async () => {
		const answer = await press(FREE_INTENT);

		expect(binary.freed).toBe(1);
		expect(binary.written).toEqual([]);
		expect(answer).toEqual({ freed: SET });
	});
});

describe('a press `/` does not answer', () => {
	it('is answered without writing, freeing or closing anything', async () => {
		const answer = await press('paypal:charity', { [PLAN_FIELD]: 'true' });

		expect(answer).toEqual({ unknown: true });
		expect(binary).toEqual({ written: [], freed: 0, closed: 0 });
	});
});
