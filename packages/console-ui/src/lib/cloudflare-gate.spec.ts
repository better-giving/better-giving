import { describe, expect, it } from 'vitest';
import type { Blocked, HomeFace, VarsRead } from '../api/types';
import { cloudflareGate } from './cloudflare-gate';

// which gate a page stands behind when cloudflare would not say what this deployment holds, and the
// words on it.
//
// pure values: this package has no DOM pool (../../vite.config.ts), so ./deployment-states.tsx draws
// from this reading and the reading is what is held here.

const NAMES = { workerName: 'better-giving', accountName: 'Riverbank Trust' };
const READ: VarsRead = { kind: 'read', vars: [] };
const DETAIL = 'code 10000: Authentication error';

const blocked = (kind: Blocked['kind']): HomeFace => ({
	kind: 'blocked',
	why: { kind, detail: DETAIL, count: 0, why: '' }
});
const noValues = (vars: VarsRead) => cloudflareGate(blocked('no-values'), vars, NAMES);

describe('a sign-in cloudflare turned down', () => {
	it('names the terminal sign-in and offers no press', () => {
		expect(cloudflareGate(blocked('refused'), READ, NAMES)).toEqual({
			title: 'Cloudflare turned this sign-in down',
			sentence: [
				'Close the console, then run ',
				{ code: 'better-giving start' },
				' in the terminal you start it from to sign in again.'
			],
			retry: false
		});
	});
});

describe('no cloudflare sign-in on this machine', () => {
	it('names the terminal sign-in and offers no press', () => {
		expect(cloudflareGate(blocked('no-credential'), READ, NAMES)).toEqual({
			title: 'Signed out of Cloudflare',
			sentence: [
				'Close the console, then run ',
				{ code: 'better-giving start' },
				' in the terminal you start it from.'
			],
			retry: false
		});
	});
});

describe('cloudflare answering nothing that can be used', () => {
	it('says it did not answer, and offers the read again', () => {
		expect(cloudflareGate(blocked('unreachable'), READ, NAMES)).toEqual({
			title: 'Cloudflare didn’t answer',
			sentence: null,
			retry: true
		});
	});

	it('says its answer could not be read, and offers the read again', () => {
		expect(noValues({ kind: 'unreadable', detail: DETAIL })).toEqual({
			title: 'Cloudflare’s answer couldn’t be read',
			sentence: null,
			retry: true
		});
	});
});

describe('a Worker that went while its page was open', () => {
	const gone = {
		title: 'This deployment is gone',
		sentence: ['No Worker called better-giving is in Riverbank Trust any more.'],
		retry: true
	};

	it('names the Worker and the account, and offers the read again', () => {
		expect(cloudflareGate({ kind: 'deploy', database: 'present' }, READ, NAMES)).toEqual(gone);
	});

	it('is the same gate when the settings read is what found it gone', () => {
		expect(noValues({ kind: 'not-deployed' })).toEqual(gone);
	});
});

describe('what cloudflare wrote', () => {
	const gated: [string, ReturnType<typeof cloudflareGate>][] = [
		['refused', cloudflareGate(blocked('refused'), READ, NAMES)],
		['signed out', cloudflareGate(blocked('no-credential'), READ, NAMES)],
		['unreachable', cloudflareGate(blocked('unreachable'), READ, NAMES)],
		['settings refused', noValues({ kind: 'refused', detail: DETAIL })],
		['settings signed out', noValues({ kind: 'no-credential', detail: DETAIL })],
		['settings unreachable', noValues({ kind: 'unreachable', detail: DETAIL })],
		['settings unreadable', noValues({ kind: 'unreadable', detail: DETAIL })]
	];

	it.each(gated)('never reaches the %s gate', (_, gate) => {
		expect(gate).not.toBeNull();
		expect(JSON.stringify(gate)).not.toContain('10000');
	});
});

describe('faces this gate is not', () => {
	it.each<[string, HomeFace]>([
		['ready', { kind: 'ready', address: 'https://better-giving.example.workers.dev' }],
		[
			'deployment unanswering',
			{ kind: 'unreachable', address: 'https://x.example', read: { kind: 'no-session' } }
		],
		['two databases', blocked('two-databases')],
		['no address', blocked('no-address')]
	])('draws none over %s', (_, face) => {
		expect(cloudflareGate(face, READ, NAMES)).toBeNull();
	});
});

// the binary blocks on the settings only where their read did not land, so a block naming a read
// that did is an answer contradicting itself.
it('reads a settings block over a settings read that landed as an answer it could not read', () => {
	expect(noValues(READ)?.title).toBe('Cloudflare’s answer couldn’t be read');
});
