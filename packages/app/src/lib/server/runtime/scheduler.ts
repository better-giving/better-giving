import type { Deferred } from './deferred';

// the in-process cron: each expression in a table fires on the UTC minutes it matches, the way a
// cron trigger fires. one process serves the deployment, so one scheduler is the only one.
//
// a tick fires the minute it lands in and only that one: a minute missed while the process was
// down, or while the event loop was held past a boundary, is never replayed.

/** one expression's work, handed the minute that fired it. */
export type ScheduledRun = (now: Date) => Promise<void>;

export interface Scheduler {
	/** fires nothing further. a run already started keeps running on the deferred-work tracker. */
	stop(): void;
}

/** where a run's one line is written, by outcome. */
export interface RunLog {
	ok(line: string): void;
	threw(line: string, error: unknown): void;
}

const MINUTE = 60_000;

const defaultLog: RunLog = {
	ok: (line) => console.log(line),
	threw: (line, error) => console.error(line, error)
};

/**
 * starts firing `runs`. every expression is parsed here, so one this module cannot read throws at
 * start instead of never firing.
 */
export function startScheduler(
	runs: Readonly<Record<string, ScheduledRun>>,
	deferred: Deferred,
	log: RunLog = defaultLog
): Scheduler {
	const schedule = Object.entries(runs).map(
		([expression, run]) => [expression, parseCron(expression), run] as const
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastFired = Math.floor(Date.now() / MINUTE);

	const tick = () => {
		const minute = Math.floor(Date.now() / MINUTE);
		if (minute > lastFired) {
			lastFired = minute;
			const now = new Date(minute * MINUTE);
			for (const [expression, matches, run] of schedule) {
				if (matches(now)) deferred.waitUntil(logged(expression, now, run, log));
			}
		}
		arm();
	};
	const arm = () => {
		timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE));
	};
	arm();

	return {
		stop() {
			clearTimeout(timer);
			timer = undefined;
		}
	};
}

/** `run`, its outcome written as one line that never rejects. */
async function logged(expression: string, now: Date, run: ScheduledRun, log: RunLog) {
	const line = `cron run expression="${expression}" start=${now.toISOString()} outcome=`;
	try {
		await run(now);
		log.ok(`${line}ok`);
	} catch (error) {
		log.threw(`${line}threw`, error);
	}
}

type FieldTest = (value: number) => boolean;

/** each field's bounds, in expression order: minute, hour, day of month, month, day of week. */
const FIELDS = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 6]
] as const;

/** one field: `*`, `*\/n` or a single number within its bounds. */
function parseField(field: string, [min, max]: readonly [number, number]): FieldTest | null {
	if (field === '*') return () => true;
	const step = /^\*\/(\d+)$/.exec(field);
	if (step) {
		const every = Number(step[1]);
		return every > 0 ? (value) => (value - min) % every === 0 : null;
	}
	if (!/^\d+$/.test(field)) return null;
	const exact = Number(field);
	return exact >= min && exact <= max ? (value) => value === exact : null;
}

/**
 * a five-field expression (minute, hour, day of month, month, day of week with Sunday 0), each
 * field `*`, `*\/n` or a single number, read as a test on a UTC minute. throws on anything else,
 * and on one restricting both day fields, which cron ORs rather than ANDs.
 */
export function parseCron(expression: string): (at: Date) => boolean {
	const fields = expression.trim().split(/\s+/);
	const tests = fields.flatMap((field, i) => {
		const bounds = FIELDS[i];
		const test = bounds && parseField(field, bounds);
		return test ? [test] : [];
	});
	const [minute, hour, day, month, weekday] = tests;
	const bothDays = fields[2] !== '*' && fields[4] !== '*';
	if (fields.length !== 5 || !minute || !hour || !day || !month || !weekday || bothDays) {
		throw new Error(`unsupported cron expression "${expression}"`);
	}
	return (at) =>
		minute(at.getUTCMinutes()) &&
		hour(at.getUTCHours()) &&
		day(at.getUTCDate()) &&
		month(at.getUTCMonth() + 1) &&
		weekday(at.getUTCDay());
}
