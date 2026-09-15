import { describe, expect, it } from 'vitest';
import type {
	ChariotFacts,
	ChariotFailure,
	ChariotOrganisation,
	ChariotRunRead,
	ChariotSetup,
	ChariotStage
} from '../api/types';
import {
	CHARIOT_BLANK,
	CHARIOT_FIELD,
	CHARIOT_FORM,
	CHARIOT_LIVE,
	CHARIOT_NOT_ADDRESS,
	CHARIOT_NOT_EMAIL,
	LINES,
	boxesStanding,
	chariotPosted,
	chariotStop,
	connectWaiting,
	failureSays,
	isChariotAddress,
	keyTurnedDown,
	lineAt,
	reportStands
} from './chariot-setup';

const organisation: ChariotOrganisation = {
	id: 'org_1',
	name: 'Riverside Food Bank',
	city: 'Portland',
	state: 'OR',
	eligible: true
};

const NO_FACTS: ChariotFacts = { organisation: null, connect: null, subscription: null };

const ended = (
	stage: ChariotStage,
	outcome: ChariotSetup,
	facts: ChariotFacts = NO_FACTS
): ChariotRunRead => ({ kind: 'ended', stage, facts, outcome });

const failure = (kind: ChariotFailure['kind']): ChariotFailure => ({ kind, detail: 'said' });

const body = (apiKey: string, address: string, contactEmail: string): FormData => {
	const posted = new FormData();
	posted.set(CHARIOT_FIELD('apiKey'), apiKey);
	posted.set(CHARIOT_FIELD('address'), address);
	posted.set(CHARIOT_FIELD('contactEmail'), contactEmail);
	return posted;
};

describe('the address box', () => {
	it('takes live and sandbox, with or without one trailing slash', () => {
		expect(isChariotAddress(CHARIOT_LIVE)).toBe(true);
		expect(isChariotAddress('https://sandboxapi.givechariot.com/')).toBe(true);
	});

	it('refuses anything past the origin, and anything not https', () => {
		for (const typed of [
			'http://api.givechariot.com',
			'https://api.givechariot.com/v1',
			'https://api.givechariot.com//',
			'https://api.givechariot.com?x=1',
			'https://user@api.givechariot.com',
			'api.givechariot.com'
		]) {
			expect(isChariotAddress(typed), typed).toBe(false);
		}
	});
});

describe('the boxes a press posts', () => {
	it('trims every box rather than sending the binary a value it turns down', () => {
		expect(
			chariotPosted(body(' key ', ' https://sandboxapi.givechariot.com ', ' a@b.org\n'))
		).toEqual({
			ok: true,
			boxes: {
				apiKey: 'key',
				address: 'https://sandboxapi.givechariot.com',
				contactEmail: 'a@b.org'
			}
		});
	});

	it('takes an emptied address, which the binary reads as live', () => {
		expect(chariotPosted(body('key', '', 'a@b.org')).ok).toBe(true);
	});

	it('refuses each box by its own field', () => {
		expect(chariotPosted(body(' ', 'https://example.org/path', ''))).toEqual({
			ok: false,
			errors: {
				[CHARIOT_FIELD('apiKey')]: CHARIOT_BLANK,
				[CHARIOT_FIELD('address')]: CHARIOT_NOT_ADDRESS,
				[CHARIOT_FIELD('contactEmail')]: CHARIOT_BLANK
			}
		});
		expect(chariotPosted(body('key', '', 'Name <a@b.org>'))).toEqual({
			ok: false,
			errors: { [CHARIOT_FIELD('contactEmail')]: CHARIOT_NOT_EMAIL }
		});
	});

	it('is the rule the form runs first, on what conform hands over', () => {
		const schema = CHARIOT_FORM.schema;
		expect(
			schema.safeParse({
				[CHARIOT_FIELD('apiKey')]: 'key',
				[CHARIOT_FIELD('contactEmail')]: 'a@b.org'
			}).success
		).toBe(true);
		const refused = schema.safeParse({
			[CHARIOT_FIELD('address')]: 'https://example.org/path',
			[CHARIOT_FIELD('contactEmail')]: 'not an address'
		});
		expect(refused.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
			[CHARIOT_FIELD('apiKey'), CHARIOT_BLANK],
			[CHARIOT_FIELD('address'), CHARIOT_NOT_ADDRESS],
			[CHARIOT_FIELD('contactEmail'), CHARIOT_NOT_EMAIL]
		]);
	});
});

describe('the ledger lines', () => {
	it('draws one line per stage, in the order the chain reaches them', () => {
		expect(LINES.map((line) => line.stage)).toEqual([
			'checking',
			'finding',
			'connecting',
			'subscribing',
			'storing'
		]);
		expect(lineAt('storing')).toBe(4);
	});
});

describe('how each way a run ends reads', () => {
	it('lands, waiting only where Chariot has not switched the Connect on', () => {
		const active = { ...NO_FACTS, connect: { id: 'con_1', active: true } };
		const off = { ...NO_FACTS, connect: { id: 'con_1', active: false } };
		expect(chariotStop({ kind: 'done' }, active)).toEqual({ kind: 'landed', waiting: false });
		expect(chariotStop({ kind: 'done' }, off)).toEqual({ kind: 'landed', waiting: true });
		expect(connectWaiting(ended('storing', { kind: 'done' }, off))).toBe(true);
		expect(connectWaiting(ended('storing', { kind: 'done' }, active))).toBe(false);
	});

	it('says a refused key at the boxes, and every other failure at the check as the check', () => {
		expect(chariotStop({ kind: 'unauthorized', failure: failure('refused') }, NO_FACTS)).toEqual({
			kind: 'key'
		});
		for (const kind of ['forbidden', 'unreachable', 'rejected', 'unreadable'] as const) {
			expect(chariotStop({ kind: 'unauthorized', failure: failure(kind) }, NO_FACTS)).toEqual({
				kind: 'failure',
				call: 'check',
				failure: failure(kind)
			});
		}
	});

	it('names the call each failure stopped', () => {
		const calls = [
			['unsearched', 'search'],
			['unconnected', 'connect'],
			['unread', 'list'],
			['unsubscribed', 'subscribe']
		] as const;
		for (const [kind, call] of calls) {
			expect(chariotStop({ kind, failure: failure('unreachable') }, NO_FACTS)).toEqual({
				kind: 'failure',
				call,
				failure: failure('unreachable')
			});
		}
	});

	it('sorts Chariot’s failures by the way out each has', () => {
		expect(failureSays(failure('refused'))).toBe('refused');
		expect(failureSays(failure('forbidden'))).toBe('forbidden');
		expect(failureSays(failure('unreachable'))).toBe('unreachable');
		expect(failureSays(failure('rejected'))).toBe('chariot');
		expect(failureSays(failure('unreadable'))).toBe('chariot');
	});

	it('carries the profile read that did not land', () => {
		const read = { kind: 'unreachable', detail: 'timeout' } as const;
		expect(chariotStop({ kind: 'unprofiled', read }, NO_FACTS)).toEqual({
			kind: 'unprofiled',
			read
		});
	});

	it('sends a missing, unlisted or shared EIN to the organisation and to Chariot', () => {
		expect(chariotStop({ kind: 'no-ein' }, NO_FACTS)).toEqual({ kind: 'no-ein' });
		expect(chariotStop({ kind: 'unlisted', ein: '123456789' }, NO_FACTS)).toEqual({
			kind: 'unlisted',
			ein: '123456789'
		});
		const candidates = [organisation, { ...organisation, id: 'org_2', city: 'Salem' }];
		expect(chariotStop({ kind: 'ambiguous', candidates }, NO_FACTS)).toEqual({
			kind: 'ambiguous',
			candidates
		});
	});

	it('names the ineligible organisation the facts found', () => {
		expect(chariotStop({ kind: 'ineligible' }, { ...NO_FACTS, organisation })).toEqual({
			kind: 'ineligible',
			name: 'Riverside Food Bank'
		});
		expect(chariotStop({ kind: 'ineligible' }, NO_FACTS)).toEqual({
			kind: 'ineligible',
			name: null
		});
	});

	it('carries why there was nowhere to subscribe', () => {
		const address = { kind: 'deployed' } as Extract<ChariotSetup, { kind: 'nowhere' }>['address'];
		expect(chariotStop({ kind: 'nowhere', address }, NO_FACTS)).toEqual({
			kind: 'nowhere',
			address
		});
		expect(chariotStop({ kind: 'insecure', origin: 'http://x.test' }, NO_FACTS)).toEqual({
			kind: 'insecure',
			origin: 'http://x.test'
		});
	});

	it('carries the write that did not land, and says the one that left a subscription standing', () => {
		const written = { kind: 'unreachable', detail: 'timeout' } as Extract<
			ChariotSetup,
			{ kind: 'unstored' }
		>['written'];
		expect(chariotStop({ kind: 'unstored', written, left: ['sub_1'] }, NO_FACTS)).toEqual({
			kind: 'unstored',
			written
		});
		expect(chariotStop({ kind: 'unretired', left: ['sub_0'] }, NO_FACTS)).toEqual({
			kind: 'unretired'
		});
		expect(chariotStop({ kind: 'console-stopped' }, NO_FACTS)).toEqual({
			kind: 'console-stopped'
		});
	});
});

describe('where a stopped run reports', () => {
	const refused = ended('checking', { kind: 'unauthorized', failure: failure('refused') });
	const unreachable = ended('checking', { kind: 'unauthorized', failure: failure('unreachable') });
	const unretired = ended('storing', { kind: 'unretired', left: ['sub_0'] });

	it('says a turned-down key at the boxes and nowhere else', () => {
		expect(keyTurnedDown(refused)).toBe(true);
		expect(reportStands(refused, false)).toBe(false);
	});

	it('keeps a ledger for Chariot not answering at the key check, which is not the key', () => {
		expect(keyTurnedDown(unreachable)).toBe(false);
		expect(reportStands(unreachable, false)).toBe(true);
	});

	it('keeps a ledger for a set-up that left an older subscription standing', () => {
		expect(reportStands(unretired, false)).toBe(true);
	});

	it('stands under the boxes only while no card is up', () => {
		expect(reportStands(unretired, true)).toBe(false);
	});

	it('draws nothing for a run that landed or is still going', () => {
		expect(reportStands(ended('storing', { kind: 'done' }), false)).toBe(false);
		expect(
			reportStands({ kind: 'running', stage: 'finding', facts: NO_FACTS, outcome: null }, false)
		).toBe(false);
	});
});

describe('what the boxes are seeded from', () => {
	const reported = { apiKey: 'old', address: CHARIOT_LIVE, contactEmail: '' };
	const sent = {
		apiKey: 'new',
		address: 'https://sandboxapi.givechariot.com',
		contactEmail: 'a@b.org'
	};

	it('is what was sent, from the moment the run says it stored it until the re-read lands', () => {
		const stored: ChariotSetup[] = [{ kind: 'done' }, { kind: 'unretired', left: ['sub_0'] }];
		for (const outcome of stored) {
			const run = ended('storing', outcome);
			expect(boxesStanding({ reported, sent, run, reread: false })).toEqual({
				seeded: sent,
				spent: true
			});
			expect(boxesStanding({ reported, sent, run, reread: true })).toEqual({
				seeded: reported,
				spent: true
			});
		}
	});

	it('is what the deployment reported where the write did not land', () => {
		const run = ended('storing', {
			kind: 'unstored',
			written: { kind: 'unreachable', detail: 'timeout' } as Extract<
				ChariotSetup,
				{ kind: 'unstored' }
			>['written'],
			left: []
		});
		expect(boxesStanding({ reported, sent, run, reread: false })).toEqual({
			seeded: reported,
			spent: false
		});
	});
});
