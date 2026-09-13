import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// the console's gate over a control left open while the page is writing — the boxes a press reads,
// and the presses themselves — and, on the same presses, over how each of them says its write
// landed.
//
// every press here is a round trip through the binary to cloudflare or to the deployment and takes
// seconds, and what it sends was read off the boxes at the moment it was made. a box still editable after that is a box
// whose contents no longer say what the press is doing: the operator types into it, the answer
// lands, and the form is put back to what the deployment now holds — with what they typed gone and
// nothing having said it would be. so every box states `disabled`, in the same reading its own save
// button already states, and the operator is held at the answer rather than typing into a form that
// is on its way out.
//
// what that reading is, is the press the box belongs to and no other. a screen drawing two presses
// puts only one of them in flight, and the boxes the other one sends are untouched by it — a form
// is put back by its own answer landing, so a write it did not make takes nothing away from it
// (`ownPress` in ./lib/smtp-fold-state.ts, and `useSavedFormState`'s reset in
// packages/operator/src/saved-form-state.react.ts, which runs on the group's own write).
//
// it reads the ports rather than the elements: `Field`, `RepeatingRows` and `SelectWithNote`
// (`@better-giving/operator/components/forms/`) are the whole of what a console screen draws a
// typed or chosen value in — `Field` and `SelectWithNote` spread a caller's `disabled` onto the box
// and `RepeatingRows` states it on every row and on both of its presses — and the sheet draws the
// closed rung for all three (`.adm-input:disabled` and `.adm-select:disabled` in
// packages/operator/src/styles/adm.css).
//
// **the press is swept as well as the box, because the box being closed says nothing about the
// press beside it.** a send that stays pressable while its own send is in flight is one errand and
// two messages: the operator presses, nothing on the control says it may not be pressed again, and
// the second press starts a second navigation. that is the hole this half was written for.
//
// **what a press is here is `SaveButton` and a `.adm-save` drawn by hand**
// (`@better-giving/operator/components/controls/SaveButton`, and the one hand-drawn twin in
// ./lib/smtp-fold.tsx, whose own comment says why it is not the shared button). those two are every
// control on this console that carries a write. a link, a disclosure toggle and the Add and Remove
// inside `RepeatingRows` are not presses by this reading and are not swept: the first two carry no
// write at all, and the last two are closed as a group by the sweep above.
//
// what is read off each of them is two things:
//
// - **it states a reading of its own press.** `SaveButton` states `state`, out of which it composes
//   the label, the live region and the closed rung; a hand-drawn press states `disabled`. a press
//   stating neither is one nothing on the screen can ever close.
// - **a press that says it is busy is closed on the same reading it says it with.** `aria-busy`
//   announces that a press is in flight, so a tag stating it out of one value and `disabled` out of
//   another is a control telling an operator it is working while taking a second press. the two
//   attributes are compared by the identifiers their expressions read rather than by their text,
//   because the closing condition is ordinarily one of several terms in `disabled`.
//
// **the same two presses carry a third rule, which is how each of them says the write landed.** an
// outcome reports at the control that carried it, so both of these draw a confirmation in place —
// and a confirmation nobody hears is a press an operator makes twice. two things hold for a press
// here, and the second is the one a hand-drawn press has to state for itself:
//
// - **the press is not the region and holds no region inside it.** a region reports every change to
//   its own contents, so a press that was one announces the tick arriving over the label and the
//   label coming back — two announcements for one write. it is also what carries `aria-busy`, which
//   a reader is told to hold, so a region there is silenced for exactly the wait it exists to
//   narrate.
// - **a region stands beside it, mounted whenever the press is.** a region that arrives carrying
//   its own text is one insertion rather than a change and is announced by nobody, so a second
//   identical outcome would be answered with silence. the sweep reads that as a JSX element under
//   the press's own parent — a region drawn inside a `{… ? … : null}` is not a child of that parent
//   and is not found, which is exactly the shape being ruled out. `SaveButton` answers this half
//   inside itself and its call sites carry nothing.
// - **it stands outside every region and not only outside its own.** the two above read down from
//   the press, which is this defect from the press's end; the same defect from the other end is a
//   region drawn around the press, and no reading of the press's own subtree can see it. under one
//   the dots arriving over the label are a change to the region's contents, so the press announces
//   itself, and what a reader hears is a resting label over a wait that has just begun.
//
// **that third half is read over every control rather than over the two presses**, because what a
// region narrates is anything inside it whose wording moves — a link relabelled, a box refused, a
// disclosure opened — and none of those carries a write. so it sweeps the ports and the native
// elements an operator can reach rather than `SaveButton` and the hand-drawn twin, and it is the one
// rule here a control that carries nothing can fail.
//
// what a control stands inside is read off the tree of tags and not off what is rendered, so a
// control a helper draws is outside every region here however the helper is called: the JSX is
// somewhere else in the file and the nesting is a call rather than a parent.
//
// **what this does not reach is whether the region is ever written into, or emptied before it is.**
// that is an effect rather than markup, and this package pins one node pool and no dom
// (../vite.config.ts) — so the clear-then-write is held by the shared button's own dom spec
// (packages/operator/src/components/controls/SaveButton.dom.spec.tsx) and by nothing here.
//
// **what this does not reach is whether the condition is the right one.** a press stating
// `disabled={false}` satisfies both halves and closes on nothing; so does one stating a flag no
// press ever sets. what the rule holds is that the reading exists and that the two attributes read
// it off the same values, which is exactly the shape the hole above had.
//
// **the attribute is read off the parsed file and never off its text.** these tags run to twenty
// lines and carry comments, nested elements and apostrophes, and a scanner walking the source for
// the `>` that ends one is wrong on the tags in this package today — ./announced-refusals.spec.ts
// gets away with reading text because the tags it sweeps are short. the compiler is already a
// dependency of this package and settles it exactly.
//
// a spread does not answer for the attribute. `{...rest}` may or may not carry one and a sweep that
// took it as a yes is a hole the next screen falls through, so a screen that closes its box inside
// an object states `disabled` beside the spread as well.
//
// the shape is ./raw-values.spec.ts's, for the reason written beside its own counting case: a sweep
// reaching nothing passes loudest, so the globs are asserted to have found the ports and the
// presses before either rule is read off them.

const PORTS = new Set(['Field', 'RepeatingRows', 'SelectWithNote']);

/** the shared button every write on this console is carried by, where it is not drawn by hand. */
const PRESS = 'SaveButton';

/** the class a press drawn by hand wears, which is how one is told from every other button. */
const HAND_DRAWN = 'adm-save';

/**
 * every control an operator can reach, by the name it is drawn under.
 *
 * the ports `@better-giving/operator` publishes a control from, the two router elements that draw a
 * link, and the native elements a screen reaches for where no port covers it. a control's wording,
 * its refusal and its closed rung all move under it, which is what a region around one narrates.
 */
const CONTROLS = new Set([
	'Breadcrumbs',
	'Button',
	'CopyControl',
	'SaveButton',
	'CheckboxGroup',
	'Field',
	'PairedFieldset',
	'RepeatingRows',
	'SelectWithNote',
	'Link',
	'NavLink',
	'a',
	'button',
	'input',
	'select',
	'summary',
	'textarea'
]);

type Tag = {
	readonly name: string;
	readonly node: ts.JsxOpeningLikeElement;
	readonly where: string;
};

/** every opening tag in these files, named and placed. */
function tags(files: readonly string[]): Tag[] {
	const found: Tag[] = [];
	for (const file of files) {
		const source = ts.createSourceFile(
			file,
			readFileSync(file, 'utf8'),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TSX
		);
		const visit = (node: ts.Node): void => {
			if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
				const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
				const name = node.tagName.getText(source);
				found.push({ name, node, where: `${file}:${line} <${name}>` });
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return found;
}

/** one attribute of a tag, by the name it is written under, or `undefined` where the tag has none. */
const attribute = (node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined =>
	node.attributes.properties.find(
		(property): property is ts.JsxAttribute =>
			ts.isJsxAttribute(property) && property.name.getText() === name
	);

/**
 * every name one attribute's expression reads, which is what two of them are compared on.
 *
 * `undefined` is dropped: it is the tail of every one of these expressions — an attribute is left
 * off rather than stated false — and comparing on it would make any two of them agree.
 */
function reads(held: ts.JsxAttribute | undefined): string[] {
	const initializer = held?.initializer;
	if (initializer === undefined || !ts.isJsxExpression(initializer)) return [];
	const names: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && node.text !== 'undefined') names.push(node.text);
		ts.forEachChild(node, visit);
	};
	visit(initializer);
	return names;
}

/** whether one tag announces its own changes, however the region is spelled. */
const isRegion = (node: ts.JsxOpeningLikeElement): boolean => {
	if (attribute(node, 'aria-live') !== undefined) return true;
	const role = attribute(node, 'role')?.initializer;
	return (
		role !== undefined &&
		ts.isStringLiteral(role) &&
		(role.text === 'status' || role.text === 'alert')
	);
};

/** the element a tag opens, which is the tag itself where it closes itself. */
const element = (tag: Tag): ts.Node =>
	ts.isJsxSelfClosingElement(tag.node) ? tag.node : tag.node.parent;

/** whether this element is a region or draws one anywhere inside it. */
function holdsRegion(node: ts.Node): boolean {
	let found = false;
	const visit = (child: ts.Node): void => {
		if (found) return;
		if ((ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) && isRegion(child)) {
			found = true;
			return;
		}
		ts.forEachChild(child, visit);
	};
	visit(node);
	return found;
}

/**
 * every element drawn beside this one under the same parent.
 *
 * only the elements: a child wrapped in an expression is mounted on whatever that expression asks,
 * and a region mounted with the state that draws it is the thing being ruled out.
 */
function besides(node: ts.Node): ts.JsxOpeningLikeElement[] {
	const parent = node.parent;
	if (parent === undefined || !(ts.isJsxElement(parent) || ts.isJsxFragment(parent))) return [];
	const found: ts.JsxOpeningLikeElement[] = [];
	for (const child of parent.children) {
		if (child === node) continue;
		if (ts.isJsxSelfClosingElement(child)) found.push(child);
		else if (ts.isJsxElement(child)) found.push(child.openingElement);
	}
	return found;
}

/**
 * whether this tag stands anywhere inside a region, however many elements up it is drawn.
 *
 * the walk starts at the element's own parent, so a region does not answer for itself: the tag that
 * opens one is the region rather than something under it.
 */
function insideRegion(tag: Tag): boolean {
	let node: ts.Node | undefined = element(tag).parent;
	while (node !== undefined && !ts.isSourceFile(node)) {
		if (ts.isJsxElement(node) && isRegion(node.openingElement)) return true;
		node = node.parent;
	}
	return false;
}

/** every region drawn in these files, which is what the rule below is read against. */
const drawnRegions = (files: readonly string[]): Tag[] =>
	tags(files).filter((tag) => isRegion(tag.node));

/** every control drawn in these files, wherever it stands. */
const drawnControls = (files: readonly string[]): Tag[] =>
	tags(files).filter((tag) => CONTROLS.has(tag.name));

/** every control a region would narrate, which is every one standing inside one. */
const controlsUnderRegions = (files: readonly string[]): string[] =>
	drawnControls(files)
		.filter(insideRegion)
		.map((tag) => tag.where);

type Drawn = { readonly where: string; readonly closable: boolean };

/** every port drawn in these files, and whether its own tag states the attribute. */
function drawnBoxes(files: readonly string[]): Drawn[] {
	return tags(files)
		.filter((tag) => PORTS.has(tag.name))
		.map((tag) => ({ where: tag.where, closable: attribute(tag.node, 'disabled') !== undefined }));
}

type Pressed = {
	readonly where: string;
	/** whether the tag states a reading of its own press at all. */
	readonly reads: boolean;
	/** whether it announces itself busy, which is the half of the rule the hole was in. */
	readonly announcesBusy: boolean;
	/** what `aria-busy` reads that `disabled` does not, which is a press open while it says it is busy. */
	readonly openWhileBusy: string[];
	/** whether it is drawn by hand, which is the one that answers for its own region. */
	readonly handDrawn: boolean;
	/** whether the press is a live region itself, or draws one inside it. */
	readonly saysItself: boolean;
	/** whether a region stands beside it under the same parent. the shared button carries its own. */
	readonly announcesBeside: boolean;
};

/** whether one tag is a press: the shared button, or a `<button>` wearing the hand-drawn class. */
const isPress = (tag: Tag): boolean =>
	tag.name === PRESS ||
	(tag.name === 'button' &&
		(attribute(tag.node, 'className')?.getText() ?? '').includes(HAND_DRAWN));

/** every press drawn in these files, read against every rule this file holds over one. */
function drawnPresses(files: readonly string[]): Pressed[] {
	return tags(files)
		.filter(isPress)
		.map((tag) => {
			const busy = attribute(tag.node, 'aria-busy');
			const closed = new Set(reads(attribute(tag.node, 'disabled')));
			const handDrawn = tag.name !== PRESS;
			const own = element(tag);
			return {
				where: tag.where,
				reads:
					attribute(tag.node, 'disabled') !== undefined ||
					attribute(tag.node, 'state') !== undefined,
				announcesBusy: busy !== undefined,
				openWhileBusy: reads(busy).filter((name) => !closed.has(name)),
				handDrawn,
				saysItself: holdsRegion(own),
				announcesBeside: !handDrawn || besides(own).some(isRegion)
			};
		});
}

describe('every box is closed while the page is writing', () => {
	const screens = globSync('src/**/*.tsx');

	it('finds the files it is meant to be guarding', () => {
		expect(screens.length).toBeGreaterThan(0);
		// and the ports inside them: a matcher that stops reading a name the screens use would
		// otherwise report an empty list, which is the same thing this file says is fine.
		expect(drawnBoxes(screens).length).toBeGreaterThan(0);
	});

	it('draws no box a press can be typed into behind', () => {
		expect(drawnBoxes(screens).filter((box) => !box.closable)).toEqual([]);
	});
});

describe('every press is closed while its own press is in flight', () => {
	const screens = globSync('src/**/*.tsx');

	it('finds the presses it is meant to be guarding', () => {
		expect(drawnPresses(screens).length).toBeGreaterThan(0);
		// and one that announces itself busy: that half of the rule is the one the hole was in, and a
		// sweep with no such press left to read it off is a rule that has stopped saying anything.
		expect(drawnPresses(screens).filter((press) => press.announcesBusy).length).toBeGreaterThan(0);
	});

	it('draws no press with nothing that could ever close it', () => {
		expect(drawnPresses(screens).filter((press) => !press.reads)).toEqual([]);
	});

	it('draws no press that says it is busy and takes a second press anyway', () => {
		expect(drawnPresses(screens).filter((press) => press.openWhileBusy.length > 0)).toEqual([]);
	});
});

describe('every press says the write landed through a region beside it', () => {
	const screens = globSync('src/**/*.tsx');

	it('finds the hand-drawn press it is meant to be guarding', () => {
		// the shared button answers the second rule inside itself, so a sweep left holding only call
		// sites of it would report an empty list for a rule it had stopped reading off anything.
		expect(drawnPresses(screens).filter((press) => press.handDrawn).length).toBeGreaterThan(0);
	});

	it('draws no press that is a live region, or that holds one', () => {
		expect(drawnPresses(screens).filter((press) => press.saysItself)).toEqual([]);
	});

	it('draws no press whose region is not standing beside it', () => {
		expect(drawnPresses(screens).filter((press) => !press.announcesBeside)).toEqual([]);
	});

	it('finds the regions and the controls the rule below is read across', () => {
		// both halves, because either one reaching nothing is a rule that passes on an empty list: a
		// console with no region left holds no control inside one, and so does a matcher that has
		// stopped recognising the names the screens draw a control under.
		expect(drawnRegions(screens).length).toBeGreaterThan(0);
		expect(drawnControls(screens).length).toBeGreaterThan(0);
	});

	it('draws no control inside a region, which would narrate the press itself', () => {
		expect(controlsUnderRegions(screens)).toEqual([]);
	});
});
