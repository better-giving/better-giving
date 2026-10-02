import { describe, expect, it } from 'vitest';
import type { PaypalRunRead, PaypalSetup, PaypalStage } from '../api/types';
import { heldPoll, polledRun, pollOutlived, runKind, standingRun, stopUnmade } from './run-poll';

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

describe('one poll of a run the page is drawing as going', () => {
	it('is the run the binary answered with', () => {
		const going = running('authorizing');
		const next = running('registering');
		expect(polledRun(going, { run: next })).toBe(next);
		expect(polledRun(going, { run: landed })).toBe(landed);
	});

	it('ends the run at the stage it was last seen at, as the console’s own stop, when nothing answered', () => {
		// a read that did not land is a console that has stopped, and the run was its memory: what
		// the screen can say is the press the binary would have answered had it died on the run's
		// own goroutine, which sends the operator to press again rather than to wait for ever.
		const going = running('registering');
		expect(polledRun(going, null)).toEqual({
			kind: 'ended',
			stage: 'registering',
			facts,
			outcome: { kind: 'console-stopped' }
		});
	});

	it('is asked only of a run whose ended arm can be the console’s own stop', () => {
		// a run whose outcomes leave the stop out would be handed a value its own type says it cannot
		// hold, and an exhaustive switch over those outcomes would draw nothing for it.
		type Unstoppable =
			| { kind: 'running'; stage: string; outcome: null }
			| { kind: 'ended'; stage: string; outcome: { kind: 'done' } };
		const going: Unstoppable = { kind: 'running', stage: 'registering', outcome: null };
		// @ts-expect-error — `console-stopped` is no outcome of this run.
		expect(polledRun<Unstoppable>(going, null)?.outcome).toEqual({ kind: 'console-stopped' });
	});

	it('is no run at all when the binary holds none, so the page reads itself again', () => {
		// the run's report went to a read this window does not hold — another window on the same
		// console — and the run is not going any more.
		expect(polledRun(running('registering'), { run: null })).toBeNull();
	});
});

describe('a stop drawn for a poll nobody answered', () => {
	// one rejected read — a 5xx, a fetch dropped across a sleep and a wake — is drawn as the
	// console's own stop and reads the page again. a run the console is still holding comes back
	// running on that re-read, and the stop was never anything the binary said.
	const reading = running('authorizing');
	const going = running('registering');
	const made = heldPoll(going, null, reading);

	it('is held as a stop made up over the reading on the screen', () => {
		expect(made.run).toEqual(polledRun(going, null));
		expect(made.stoppedOver).toEqual({ reading });
	});

	it('gives way to a re-read that finds the run still going, which is drawn running', () => {
		const reread = running('registering');
		expect(pollOutlived(runKind(reading), runKind(reread))).toBe(false);
		expect(stopUnmade(made, reread)).toBe(true);
		const { live } = standingRun({ run: reread, polled: undefined, remembered: made.run });
		expect(live).toBe(reread);
	});

	it('stands over the reading it was drawn over, until the re-read lands', () => {
		expect(stopUnmade(made, reading)).toBe(false);
	});

	it('stands over a re-read that finds the run over or gone', () => {
		expect(stopUnmade(made, landed)).toBe(false);
		expect(stopUnmade(made, null)).toBe(false);
	});

	it('is never a stop the binary answered, which a re-read cannot take back', () => {
		const answered = heldPoll(going, { run: stopped }, reading);
		expect(answered.stoppedOver).toBeNull();
		expect(stopUnmade(answered, running('registering'))).toBe(false);
		expect(stopUnmade(undefined, running('registering'))).toBe(false);
	});
});
