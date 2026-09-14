import { describe, expect, it } from 'vitest';
import type { PaypalRunRead, PaypalSetup, PaypalStage } from '../api/types';
import { pollOutlived, runKind, standingRun } from './run-poll';

const facts = { registration: null, elsewhere: [] };

const running = (stage: PaypalStage): PaypalRunRead => ({
	kind: 'running',
	stage,
	facts,
	outcome: null
});

const ended = (stage: PaypalStage, outcome: PaypalSetup): PaypalRunRead => ({
	kind: 'ended',
	stage,
	facts,
	outcome
});

const landed = ended('storing', { kind: 'done' });
const stopped = ended('registering', { kind: 'full', listeners: [] });

describe('a poll answer against a run the page reads afresh', () => {
	it('gives way to a run started without a press here', () => {
		// the page held no run after the last one stopped, and the poll still holds that stop.
		const started = running('authorizing');
		expect(standingRun({ run: started, polled: stopped, remembered: stopped }).live).toBe(stopped);

		expect(pollOutlived(runKind(null), runKind(started))).toBe(true);
		const { live } = standingRun({ run: started, polled: undefined, remembered: stopped });
		expect(live).toBe(started);
		expect(live?.kind).toBe('running');
	});

	it('gives way to a stop the reading saw before the poll did', () => {
		expect(pollOutlived('running', 'ended')).toBe(true);
	});

	it('stands through a re-read of the same run, whatever object that re-read hands down', () => {
		expect(pollOutlived(runKind(running('authorizing')), runKind(running('registering')))).toBe(
			false
		);
		expect(pollOutlived(runKind(null), runKind(null))).toBe(false);
	});
});

describe('the run a page draws', () => {
	it('is the reading where no poll answer is held, as a press leaves it', () => {
		const run = running('registering');
		expect(standingRun({ run, polled: undefined, remembered: null })).toEqual({
			answered: run,
			live: run
		});
	});

	it('keeps a landed run on screen once the re-read it set off comes back holding none', () => {
		// the stop asks the page again, and that reading finds the run consumed.
		expect(pollOutlived('running', runKind(null))).toBe(true);
		const { answered, live } = standingRun({ run: null, polled: undefined, remembered: landed });
		expect(answered).toBeNull();
		expect(live).toBe(landed);
	});

	it('is the poll answer while one is held', () => {
		expect(
			standingRun({ run: running('authorizing'), polled: landed, remembered: null }).live
		).toBe(landed);
	});
});
