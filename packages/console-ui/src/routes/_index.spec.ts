import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClientActionFunctionArgs } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, VarsWritten } from '../api/types';

// the presses `/` answers, posted here from over any page (../lib/close-confirm.tsx's
// `SHELL_ACTION`): which write each intent makes on the binary, and that each forgets the
// processor pages kept between visits. the client and that store are replaced so every write is a
// record of what it was sent, and every forget a count.

const binary = vi.hoisted(() => ({
	written: [] as Record<string, string | null>[],
	freed: 0,
	closed: 0,
	forgot: 0
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

vi.mock('../lib/processor-cache', async (original) => ({
	...(await original<Record<string, unknown>>()),
	forgetReadings: async () => {
		binary.forgot += 1;
	}
}));

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
	binary.forgot = 0;
});

describe('a press `/` does not answer', () => {
	it.each([
		['a section page’s own', 'paypal:charity'],
		['the free a section page answers for itself', FREE_INTENT]
	])('is answered without writing, freeing or closing anything: %s', async (_, intent) => {
		const answer = await press(intent);

		expect(answer).toEqual({ unknown: true });
		expect(binary).toEqual({ written: [], freed: 0, closed: 0, forgot: 1 });
	});
});

describe('a connect press the deployment refused for this machine’s clock', () => {
	const connection: Connection = {
		kind: 'clock-ahead',
		expiresAt: '',
		origin: 'https://example.workers.dev',
		detail: '',
		message: 'This console’s clock reads ahead of this deployment’s.',
		fix: 'Set the clock on `this machine` right, then connect again.'
	};
	const drawn = renderToStaticMarkup(
		createElement(home.ConnectOutcome, {
			connected: connection,
			workerName: 'better-giving',
			accountName: 'Example'
		})
	);

	const read = drawn.replace(/<[^>]+>/g, '');

	it('says it in the deployment’s own two sentences, the way out marked', () => {
		expect(read).toContain('This console’s clock reads ahead of this deployment’s.');
		expect(read).toContain('Set the clock on this machine right, then connect again.');
		expect(drawn).toContain('this machine</code>');
	});

	it('puts no cloudflare quotation over them', () => {
		expect(drawn).not.toContain('Cloudflare');
		expect(drawn).not.toContain('adm-cmd');
	});
});
