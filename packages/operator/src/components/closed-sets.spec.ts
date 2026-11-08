import { describe, expect, it } from 'vitest';
import { classesDrawnIn, modifiersDefinedIn, statesDefinedIn } from '../styles/vocabulary';
import type { PointerState, Tone } from './closed-sets.js';
import { BUTTON_VARIANT_CLASS, type ButtonSize, type ButtonVariant } from './controls/Button.jsx';
import type { Reading } from './data/DataTable.jsx';
import type { MarkSize } from './status/Mark.jsx';
import type { StatusTone } from './status/StatusLine.jsx';
import { BADGE_VARIANT_CLASS } from './status/StatusWord.jsx';

// every member of every union a component assembles a class from is a suffix the sheets draw, and
// every suffix the sheets draw under one of those stems is a member.
//
// **it exists because an assembled name is a name nothing else can read.** a component writes
// `` `adm-status--${tone}` ``, so the class never appears in the source as a literal and no sweep
// over the components can see it: the union the prop takes is the whole of what stands between the
// stem and the sheet. where a member has no rule behind it the element paints exactly as the bare
// stem does — no error, no warning, and a control that looks correct in every review.
//
// **it runs in both directions, which is what separates it from ./pinned-states.spec.ts.** that
// file sweeps from a component's union to the sheets and says why it goes only that way: a twin
// drawn for a component that does not offer it costs nothing. here the pair is a whole vocabulary
// against a whole union, so a rule the sheets draw under a stem no member reaches fails too. that
// half is the one that catches a modifier left behind by a component that has gone.
//
// **the states half is the `is-*` vocabulary whole.** ./pinned-states.spec.ts reads it per component
// from the union to the sheets; here the vocabulary is small enough to be asserted whole, both ways.
//
// **a class a component takes from the registry's table is held to the registry's copied sheet.**
// ./controls/Button.jsx and ./status/StatusWord.jsx assemble a `ds-*` class from a variant or a
// tone through a table, so that table is read against the sheet it names.
//
// each case reads the sheet rather than restating it, and an exception would be a listed line with
// its reason on it. what an assertion here refuses is a list quietly widened until it matched.

/** the three sheets every operator surface is dressed from, in the order each `app.css` imports them. */
const SHEETS = ['tokens.css', 'base.css', 'adm.css'].map((file) => `src/styles/${file}`);

/**
 * the registry's copied sheets a component draws a class from, beside the three above
 * (packages/app/src/app.css imports them into the `registry` layer).
 */
const REGISTRY = {
	button: 'src/registry/styles/button-css.css',
	badge: 'src/registry/styles/badge-css.css'
};

/**
 * a union's members, as a list tsc holds to the union in both directions.
 *
 * a member the union does not have is refused by the constraint, and a union member the list is
 * missing is refused by the second argument — which is where the compiler prints the name of the
 * one that is missing. without both halves this file would be asserting a hand-kept list against a
 * stylesheet and calling it a union.
 */
function closed<Union extends string>() {
	return <List extends readonly Union[]>(
		list: List,
		_complete: [Union] extends [List[number]] ? true : Exclude<Union, List[number]>
	): readonly Union[] => list;
}

const BUTTON_VARIANTS = closed<ButtonVariant>()(
	['default', 'primary', 'danger', 'quiet', 'soft'],
	true
);
const BUTTON_SIZES = closed<ButtonSize>()(['md', 'sm'], true);
const MARK_SIZES = closed<MarkSize>()(['md', 'lg'], true);
const TONES = closed<Tone>()(['blocker', 'attention', 'note', 'done'], true);
const STATUS_TONES = closed<StatusTone>()(
	['blocker', 'attention', 'note', 'done', 'resolved', 'running'],
	true
);
const CELL_READINGS = closed<Reading>()(
	['count', 'date', 'money', 'whole', 'noted', 'prose'],
	true
);
/** the shared set ./closed-sets.js names, held here so a member added to it fails this file's own type check. */
const POINTER_STATES = closed<PointerState>()(['hover', 'focus'], true);

/** the suffixes one stem is drawn with, sorted, so a failure prints two comparable lists. */
function drawn(stem: string): readonly string[] {
	return [...modifiersDefinedIn(SHEETS, stem)].sort();
}

function sorted(names: readonly string[]): readonly string[] {
	return [...new Set(names)].sort();
}

describe('the registry classes the operator components assemble', () => {
	const button = classesDrawnIn([REGISTRY.button]);
	const badge = classesDrawnIn([REGISTRY.badge]);

	it('reach a sheet', () => {
		// the non-empty guard every source-reading gate in this package makes first: a registry sheet
		// this stopped reading draws nothing, and every class would then read as one it is missing.
		expect([button.has('ds-btn'), badge.has('ds-badge')]).toEqual([true, true]);
	});

	// ./controls/Button.jsx assembles its rank from a table rather than a literal, so the table is
	// the whole of what stands between a variant and the registry's sheet. the size and the shape are
	// literals beside it, held here so the three are read in one place.
	it('are ranks, a size and a shape the registry’s button-css draws', () => {
		expect(
			sorted(
				[
					...BUTTON_VARIANTS.map((variant) => BUTTON_VARIANT_CLASS[variant]),
					'ds-btn-sm',
					'ds-btn-icon'
				].filter((name) => !button.has(name))
			)
		).toEqual([]);
	});

	it('are a badge the registry’s badge-css draws for every tone', () => {
		expect(
			sorted(TONES.map((tone) => BADGE_VARIANT_CLASS[tone]).filter((name) => !badge.has(name)))
		).toEqual([]);
	});
});

describe('the modifiers the operator components assemble', () => {
	it('reach a sheet', () => {
		expect(drawn('adm-status').length).toBeGreaterThan(2);
	});

	// what ./controls/Button.jsx writes under `.adm-btn--` is two hooks and no rank: the quiet rank
	// and the small size are what a screen places a press by, and the look of every rank and size is
	// the registry's. a variant or a size the sheet drew a modifier for beyond these two would be a
	// local rank drawn over the registry's.
	it('are the two hooks .adm-btn-- draws', () => {
		expect(
			sorted([
				...BUTTON_VARIANTS.filter((variant) => variant === 'quiet'),
				...BUTTON_SIZES.filter((size) => size === 'sm')
			])
		).toEqual(drawn('adm-btn'));
	});

	// a note is a fact and a fact is not coloured: the bare `.adm-banner` is already that tone.
	// ./status/StatusLine.jsx spells its own tone unconditionally and so has a `--note` rule.
	it('are the tones .adm-banner-- draws', () => {
		expect(sorted(TONES.filter((tone) => tone !== 'note'))).toEqual(drawn('adm-banner'));
	});

	it('are the tones .adm-status-- draws', () => {
		expect(
			sorted([
				...STATUS_TONES,
				// the arrangement a line takes when it opens in place, which every tone can be in.
				// ./status/StatusLine.jsx writes it as a literal.
				'section',
				// the state a line is in while its subject does not exist yet, which composes over a
				// tone rather than being one of them — so it is the `dim` prop and no member of the
				// union above. the same file writes it as a literal too.
				'dim'
			])
		).toEqual(drawn('adm-status'));
	});

	// the readings and not the column kinds: a cell may state one of its own, and two of them are
	// readings no column may take. holding the wider union is what holds `CellKind` too, since every
	// kind is a member of it.
	it('are the readings .adm-cell-- draws', () => {
		expect(
			sorted([
				// prose is the reading a cell wears nothing for, so it names no rule to find. `noted`
				// wears money's rule as well as its own, which is the reading-to-suffix table in
				// ./data/DataTable.jsx and is why this is not a member-for-rule count.
				...CELL_READINGS.filter((reading) => reading !== 'prose'),
				// what a cell with no value wears, which is the row's fact rather than the column's
				// kind — ./data/DataTable.jsx writes it as a literal.
				'empty'
			])
		).toEqual(drawn('adm-cell'));
	});

	// `md` is the mark every line carries, and it takes no modifier.
	it('are the sizes .adm-mark-- draws', () => {
		expect(sorted(MARK_SIZES.filter((size) => size !== 'md'))).toEqual(drawn('adm-mark'));
	});
});

describe('the states the operator components assemble', () => {
	it('reach a sheet', () => {
		expect(statesDefinedIn(SHEETS).size).toBeGreaterThan(4);
	});

	it('are the `is-` names the sheets draw', () => {
		expect(
			sorted([
				...POINTER_STATES,
				// the twin `:active` takes beside it, which packages/app/src/lib/admin/styles/conformance.spec.ts
				// requires of every state rule. no component pins it, and ../styles/adm.css says so in a
				// `carried-ok:` note.
				'active',
				// the destination a reader is on. it is a boolean on ./shell/DestinationCell.jsx rather
				// than a member of a state union, because a cell can be current and hovered at once.
				'current',
				// the progress bar's done state. ./status/ProgressBar.jsx writes it off a boolean rather
				// than off a state union, so there is no union for it to be a member of and the sheet's
				// own `carried-ok:` note is what stands for its call site.
				'finishing',
				// a card part a file is dragged over. the media card in
				// packages/app/src/lib/admin/page-edit/campaign-cards.tsx writes it off a boolean.
				'drop'
			])
		).toEqual([...statesDefinedIn(SHEETS)].sort());
	});
});
