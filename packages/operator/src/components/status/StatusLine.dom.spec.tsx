import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { StatusLedger, StatusLine, StatusStep } from './StatusLine.jsx';

// what a reader who cannot see the run is told about it. the ledger says how many capabilities are
// being reported and where one of them ends, and it has to keep saying that under
// ../../styles/base.css's reset, which takes the marker off every list in the document.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the element the ledger drew, which is where a case reads the run off. */
function ledger(root: HTMLElement): Element {
	const drawn = root.firstElementChild;
	if (drawn === null) throw new Error('the ledger drew nothing');
	return drawn;
}

/** what the ledger holds, whatever it holds it as. */
function entries(root: HTMLElement): Element[] {
	return [...ledger(root).children];
}

/** the entries the ledger holds as items of a list, which is the outline a reader is given. */
function items(root: HTMLElement): Element[] {
	return entries(root).filter((entry) => entry.tagName === 'LI');
}

/** the words one entry puts on the screen, in the order a reader meets them. */
function reading(entry: Element | undefined): (string | undefined)[] {
	// an entry the ledger does not hold is the case's own claim being wrong, and reading three
	// blanks off it would pass against a run that is not there.
	if (entry === undefined) throw new Error('the ledger holds no entry there');
	return ['.adm-status__label', '.adm-status__word', '.adm-status__note'].map((part) =>
		entry.querySelector(part)?.textContent?.trim()
	);
}

/** the element that draws the line, which is where a case reads what the line is wearing off. */
function drawn(root: HTMLElement): Element {
	const line = root.querySelector('.adm-status');
	// a line drawn without it is a line no rule in ../../styles/adm.css reaches, and reading a
	// missing class off nothing would pass against a row that is not there.
	if (line === null) throw new Error('the ledger drew no line');
	return line;
}

/** the summary a reader presses to open a line, which is the only way one opens. */
function summary(root: HTMLElement): Element {
	const found = root.querySelector('summary');
	// a line drawn without one is a line nothing can open, and a press against nothing would report
	// nothing and pass.
	if (found === null) throw new Error('the line drew no summary');
	return found;
}

/** a press on that summary, and the work react schedules off it. */
async function press(root: HTMLElement) {
	await act(async () => {
		summary(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await Promise.resolve();
	});
}

/** what an element's description resolves to, as the words themselves. */
function described(root: HTMLElement, from: Element | null): (string | undefined)[] {
	const tokens = from?.getAttribute('aria-describedby');
	if (!tokens) return [];
	return tokens.split(' ').map((token) => root.querySelector(`#${token}`)?.textContent?.trim());
}

/** the three the dashboard reports, as a blocked deployment draws them. */
const blocked = [
	<StatusLine key="pay" labelAs="span" label="Payments" word="Ready" tone="done" />,
	<StatusLine
		key="mail"
		labelAs="span"
		label="Email"
		word="Not set"
		tone="blocker"
		note="No receipt will reach a donor."
	/>,
	<StatusLine
		key="origins"
		labelAs="span"
		label="Origins"
		word="Not set"
		tone="attention"
		note="The form will not load on your site."
	/>
];

describe('a ledger mounted into a document', () => {
	it('draws the run as a list, and says so where the reset would take it back', () => {
		// ../../styles/base.css sets `list-style: none` on every list, and webkit answers a list
		// drawn that way by dropping it from what it reports. the role is what holds it.
		const root = render(StatusLedger, { children: blocked });

		expect(ledger(root).tagName).toBe('UL');
		expect(ledger(root).getAttribute('role')).toBe('list');
	});

	it('makes every line an item, so a reader is told how many there are', () => {
		const root = render(StatusLedger, { children: blocked });

		expect(entries(root).map((entry) => entry.tagName)).toEqual(['LI', 'LI', 'LI']);
	});

	it('makes an item of a line that opens too, and it reads the same as one that does not', () => {
		const shut = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="Email"
					word="Not set"
					tone="blocker"
					note="No receipt will reach a donor."
				/>
			)
		});
		const opens = render(StatusLedger, {
			sections: true,
			children: (
				<StatusLine
					labelAs="span"
					label="Email"
					word="Not set"
					tone="blocker"
					note="No receipt will reach a donor."
					beneath={<p>Nothing is configured yet.</p>}
				/>
			)
		});

		expect(entries(opens).map((entry) => entry.tagName)).toEqual(['LI']);
		expect(reading(entries(opens)[0])).toEqual(reading(entries(shut)[0]));
	});

	it('tells the caller when a line is opened in place', async () => {
		// the element holds that state and nothing else on the page can read it, so a control over
		// the whole ledger cannot say what it did unless each line says what happened to it.
		const opened = vi.fn();
		const root = render(StatusLedger, {
			sections: true,
			children: (
				<StatusLine
					labelAs="h3"
					label="Email"
					word="Not set"
					tone="blocker"
					beneath={<p>Nothing is configured yet.</p>}
					onToggle={opened}
				/>
			)
		});

		await press(root);

		expect(opened.mock.calls).toEqual([[true]]);
	});

	it('tells it again when the same line is shut', async () => {
		// both directions or neither: a control told only about opening counts one line open for
		// every one a reader has since closed by hand.
		const reported = vi.fn();
		const root = render(StatusLedger, {
			sections: true,
			children: (
				<StatusLine
					labelAs="h3"
					label="Email"
					word="Not set"
					tone="blocker"
					beneath={<p>Nothing is configured yet.</p>}
					onToggle={reported}
				/>
			)
		});

		await press(root);
		await press(root);

		expect(reported.mock.calls).toEqual([[true], [false]]);
	});

	it('keeps a resolved line in its place, so the outline does not renumber', () => {
		// the same three once the mail settings are in: the line loses its sentence and keeps
		// everything that says where it is in the run.
		const repaired = render(StatusLedger, {
			children: [
				blocked[0],
				<StatusLine key="mail" labelAs="span" label="Email" word="Set" tone="resolved" />,
				blocked[2]
			]
		});
		const before = render(StatusLedger, { children: blocked });

		expect(items(repaired).map((item) => reading(item)[0])).toEqual(
			items(before).map((item) => reading(item)[0])
		);
		expect(items(repaired).map((item) => reading(item)[0])).toEqual([
			'Payments',
			'Email',
			'Origins'
		]);
		expect(reading(items(repaired)[1])[2]).toBeUndefined();
	});

	it('keeps the label the focus target at whatever level the caller stated', () => {
		// a screen sends focus here when the control it acted on has gone with the state that drew
		// it, and what it lands on has to say both what this is and what changed about it.
		const root = render(StatusLedger, {
			sections: true,
			children: (
				<StatusLine
					labelAs="h3"
					id="cap-email"
					label="Email"
					word="Not set"
					tone="blocker"
					note="No receipt will reach a donor."
					beneath={<p>Nothing is configured yet.</p>}
				/>
			)
		});
		const heading = root.querySelector('h3.adm-status__label');

		expect(heading?.getAttribute('id')).toBe('cap-email');
		expect(heading?.getAttribute('tabindex')).toBe('-1');
		expect(described(root, heading)).toEqual(['Not set', 'No receipt will reach a donor.']);
	});

	it('reads a line whose subject does not exist yet as dim, in either drawing', () => {
		// the whole row goes back to muted ink while there is nothing to report on, and the tone it
		// will read as once the thing is made stays on it — so a row lights up as a chain reaches it
		// without the ledger's outline changing shape. both drawings carry it: the deploy board's
		// lines are statements and a ledger of capabilities is a run of sections.
		const lit = render(StatusLedger, {
			children: <StatusLine labelAs="h3" label="Database" word="Waiting" tone="note" />
		});
		const waiting = render(StatusLedger, {
			children: <StatusLine labelAs="h3" label="Database" word="Waiting" tone="note" dim />
		});
		const opens = render(StatusLedger, {
			sections: true,
			children: (
				<StatusLine
					labelAs="h3"
					label="Database"
					word="Waiting"
					tone="note"
					dim
					beneath={<p>Nothing is made yet.</p>}
				/>
			)
		});

		expect(drawn(lit).className).toBe('adm-status adm-status--note');
		expect(drawn(waiting).className).toBe('adm-status adm-status--note adm-status--dim');
		expect(drawn(opens).className).toBe(
			'adm-status adm-status--note adm-status--section adm-status--dim'
		);
	});

	it('draws the label at the level the caller stated, and at none where it stated none', () => {
		const statement = render(StatusLedger, { children: blocked });
		const section = render(StatusLedger, {
			sections: true,
			children: (
				<StatusLine
					labelAs="h3"
					label="Payments"
					word="Ready"
					tone="done"
					beneath={<p>The key is stored.</p>}
				/>
			)
		});

		expect(statement.querySelector('.adm-status__label')?.tagName).toBe('SPAN');
		expect(section.querySelector('.adm-status__label')?.tagName).toBe('H3');
	});
});

describe('the way on from a line', () => {
	/** the link a line drew, wherever it drew it. */
	function fix(root: HTMLElement): Element | null {
		return root.querySelector('.adm-status a');
	}

	it('hangs the link off the sentence where the line has one', () => {
		// the space is the link's and not the note's, so the sentence and the words after it are one
		// run rather than a sentence with a gap at the end of it.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="Recurring gifts"
					word="Unavailable"
					tone="attention"
					note="This key cannot charge a saved card."
					fixHref="/payments"
					fixLabel="Set a key"
				/>
			)
		});

		expect(fix(root)?.parentElement?.className).toBe('adm-status__note');
		expect(root.querySelector('.adm-status__note')?.textContent).toBe(
			'This key cannot charge a saved card. Set a key'
		);
	});

	it('gives the link a block of its own where the line has nothing left to say', () => {
		// a step that is done still leads somewhere, and a line that could only link from inside a
		// sentence would have to be handed one it does not have.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="The account"
					word="Chosen"
					tone="done"
					fixHref="/account"
					fixLabel="Review"
				/>
			)
		});

		expect(fix(root)?.getAttribute('href')).toBe('/account');
		expect(fix(root)?.parentElement?.className).toBe('adm-status__fix');
		expect(root.querySelector('.adm-status__note')).toBeNull();
	});

	it('leaves that link out of what describes the label', () => {
		// the description says what the line is about. one that was only the link's own words tells a
		// reader nothing the link does not already say.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					id="step-account"
					label="The account"
					word="Chosen"
					tone="done"
					fixHref="/account"
					fixLabel="Review"
				/>
			)
		});

		expect(described(root, root.querySelector('.adm-status__label'))).toEqual(['Chosen']);
	});

	it('draws no link where the line names nowhere to go', () => {
		const root = render(StatusLedger, { children: blocked });

		expect(fix(root)).toBeNull();
	});
});

describe('a line opened into its own steps', () => {
	/** the line a run in progress draws: three steps, with the chain in the second of them. */
	const working = (
		<StatusLine
			labelAs="span"
			label="Donation backend"
			word="Working"
			tone="running"
			note="Serves your donation form and the dashboard where you manage it."
			steps={
				<>
					<StatusStep state="done">Building your donation form and dashboard.</StatusStep>
					<StatusStep state="running">Preparing the tables your records are kept in.</StatusStep>
					<StatusStep state="waiting">Uploading it to Cloudflare.</StatusStep>
				</>
			}
		/>
	);

	it('keeps the line one item of the ledger, however many steps stand under it', () => {
		// the ledger reports three subjects and not eleven. a step belongs to a line, so it is an
		// item of the line's own list and never of the run above it.
		const root = render(StatusLedger, { children: working });

		expect(entries(root).map((entry) => entry.tagName)).toEqual(['LI']);
	});

	it('draws the steps as a list of their own, and says so where the reset would take it back', () => {
		const root = render(StatusLedger, { children: working });
		const steps = root.querySelector('.adm-status__steps');

		expect(steps?.tagName).toBe('UL');
		expect(steps?.getAttribute('role')).toBe('list');
	});

	it('stands them in the line and not in its body, which is what keeps them off an inset', () => {
		// ../../styles/adm.css draws the steps across the line's own two tracks. inside the body
		// they would be inside the second of them, and every step would begin a gutter in.
		const root = render(StatusLedger, { children: working });

		expect(root.querySelector('.adm-status__body .adm-status__steps')).toBeNull();
		expect(root.querySelector('.adm-status > .adm-status__steps')).not.toBeNull();
	});

	it('says where each step stands where a reader who cannot see the mark meets it', () => {
		const root = render(StatusLedger, { children: working });
		const marks = [...root.querySelectorAll('.adm-status__step .adm-mark')];

		expect(marks.map((mark) => mark.getAttribute('aria-label'))).toEqual([
			'Done',
			'Working',
			'Waiting'
		]);
	});

	it('draws no list at all on a line with no steps to open into', () => {
		const root = render(StatusLedger, { children: blocked });

		expect(root.querySelector('.adm-status__steps')).toBeNull();
	});

	it('keeps a step’s mark out of the line’s own mark', () => {
		// the two are told apart by where they stand and by nothing else. a step's mark sits inside
		// `.adm-status__steps`, which is a child of the line rather than of the line's own mark, so a
		// rule written against every mark under a running line would reach all three of them and set
		// the finished step's tick turning beside the working one.
		const root = render(StatusLedger, { children: working });
		const mark = root.querySelector('.adm-status__mark');
		const steps = [...root.querySelectorAll('.adm-status__step-mark')];

		expect(steps).toHaveLength(3);
		expect(steps.some((step) => mark?.contains(step))).toBe(false);
	});
});

describe('the loader a line carries where no step of its own can', () => {
	/** the element the mark drew on the line itself, which is where every case below reads it off. */
	const lineMark = (root: HTMLElement) => root.querySelector('.adm-status__mark .adm-mark');

	/** the marks the run of steps drew, in the order they stand under the line. */
	const stepMarks = (root: HTMLElement) => [
		...root.querySelectorAll('.adm-status__step-mark .adm-mark')
	];

	/** the line whose subject is one step, which is the shape the fold is about. */
	const lone = (
		<StatusLine
			labelAs="span"
			label="Database"
			word="Working"
			tone="running"
			note="Stores donation and donor records."
			steps={<StatusStep state="running">Making it in your Cloudflare account.</StatusStep>}
		/>
	);

	it('folds a lone step into the line rather than printing it under one', () => {
		// a subject made of one step has that step's sentence saying what the line's own sentence
		// just said, six words above it.
		const root = render(StatusLedger, { children: lone });

		expect(root.querySelector('.adm-status__steps')).toBeNull();
		expect(root.textContent).not.toContain('Making it in your Cloudflare account.');
	});

	it('turns its own mark where it drew no steps, and where it folded the one it had', () => {
		// ../../styles/adm.css turns `.adm-dots` and nothing else, so this is the whole of what says
		// the line is the thing moving.
		const none = render(StatusLedger, {
			children: <StatusLine labelAs="span" label="Deployment" word="Working" tone="running" />
		});
		const folded = render(StatusLedger, { children: lone });

		expect(lineMark(none)?.classList.contains('adm-dots')).toBe(true);
		expect(lineMark(folded)?.classList.contains('adm-dots')).toBe(true);
	});

	it('holds its own mark still where its steps are the thing moving', () => {
		// two things moving over one report is an animation a reader watches instead of a state they
		// read, so the line gives the movement up the moment a run of steps can carry it.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="Donation backend"
					word="Working"
					tone="running"
					steps={
						<>
							<StatusStep state="running">Uploading it to Cloudflare.</StatusStep>
							<StatusStep state="waiting">
								Checking it came back with everything it needs.
							</StatusStep>
						</>
					}
				/>
			)
		});

		expect(root.querySelector('.adm-status__steps')).not.toBeNull();
		expect(lineMark(root)?.classList.contains('adm-dots')).toBe(false);
	});

	it('turns the working step’s mark, which is the movement the line gave up', () => {
		// the line holds still the moment a run of steps can carry the movement, so a working step
		// that did not take it leaves nothing on the report moving at all. ../../styles/adm.css turns
		// `.adm-dots` and nothing else, and the two settled states are not moving.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="Donation backend"
					word="Working"
					tone="running"
					steps={
						<>
							<StatusStep state="done">Building your donation form and dashboard.</StatusStep>
							<StatusStep state="running">Uploading it to Cloudflare.</StatusStep>
							<StatusStep state="waiting">
								Checking it came back with everything it needs.
							</StatusStep>
						</>
					}
				/>
			)
		});

		expect(stepMarks(root).map((mark) => mark.classList.contains('adm-dots'))).toEqual([
			false,
			true,
			false
		]);
	});

	it('leaves a mark the screen named alone', () => {
		// a screen that states its own mark has said what the line reads as, and a loader put over
		// that would be the part overruling it.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="Donation page"
					word="Working"
					tone="running"
					mark="circle-dashed"
				/>
			)
		});

		expect(lineMark(root)?.classList.contains('adm-dots')).toBe(false);
	});
});

describe('a line whose label states its own state in words', () => {
	/* a line carrying its own state: the label says where it stands — `Provisioning` while it is
	   happening, and the past tense once it is not — so there is nothing left for a word beside it to
	   add. the tone makes no difference to that, which is the whole of what these two read: what
	   qualifies a line for `wordOnMark` is its label, not its being finished. */
	const row = (
		<StatusLine
			labelAs="span"
			label="Provisioning D1 database"
			word="Working"
			wordOnMark
			tone="running"
		/>
	);

	it('draws no status word beside it, however unfinished the line is', () => {
		const root = render(StatusLedger, { children: row });

		expect(root.querySelector('.adm-status__word')).toBeNull();
	});

	it('names the line’s own mark with that word, so a reader who cannot see it is still told', () => {
		const root = render(StatusLedger, { children: row });
		const mark = root.querySelector('.adm-status__mark .adm-mark');

		expect(mark?.getAttribute('aria-label')).toBe('Working');
	});
});

describe('what a line draws under its label about its own progress', () => {
	/** the classes the head holds, in the order a reader meets them. */
	function head(root: HTMLElement): (string | null)[] {
		const found = root.querySelector('.adm-status__head');
		// a head the line did not draw would read as an empty run here, and a case asserting an
		// order against nothing passes against a row that has none.
		if (found === null) throw new Error('the line drew no head');
		return [...found.children].map((part) => part.getAttribute('class'));
	}

	/** what a caller hands over, which is its own element wearing its own class and not this part's. */
	const count = <span className="adm-caption">3 of 8</span>;

	it('stands it on the head, which is what starts it on the label’s own edge', () => {
		// where it starts is the markup's and how it is set is the caller's: in the body it would
		// begin a gutter in from the label, and no rule on the head could pull it back.
		const root = render(StatusLedger, {
			children: (
				<StatusLine
					labelAs="span"
					label="Downloading app assets"
					word="Working"
					wordOnMark
					tone="running"
					aside={count}
				/>
			)
		});

		expect(head(root)).toEqual(['adm-status__label', 'adm-caption']);
	});

	it('puts it after the word on a line that draws one', () => {
		// the word qualifies the label and belongs against it, so nothing stands between the two.
		const root = render(StatusLedger, {
			children: (
				<StatusLine labelAs="span" label="Schema" word="Migrating" tone="running" aside={count} />
			)
		});

		expect(head(root)).toEqual(['adm-status__label', 'adm-status__word', 'adm-caption']);
	});

	it('draws nothing of its own where the line hands it nothing', () => {
		// no wrapper, so a line with no progress to report has a head of exactly the two parts it
		// always had — and a rule written against the head's last child still reaches the word.
		const root = render(StatusLedger, {
			children: <StatusLine labelAs="span" label="Schema" word="Migrating" tone="running" />
		});

		expect(head(root)).toEqual(['adm-status__label', 'adm-status__word']);
	});
});
