import { defineDonateForm, DONATE_FORM_TAG } from '../src/element';
import { devRuntime, FIXTURE_NAMES, FIXTURES, type FixtureName } from './fixtures';
import { remember, remembered } from './state';

// the dev page: one real `<bg-donate-form>` on a ground a contributor can change, and a panel of
// controls beside it for the things the element will not otherwise show you — a brand against the
// card it is drawn on, the unseeded grey, and the configurations nobody has a deployment for.
//
// it is `pnpm run form` and nothing else runs it. it is not a test and asserts nothing; a class that
// paints nothing paints nothing here too, and the page will look plausible while it does.
//
// **the panel is not the form.** everything it wears is ./page.css, which is this page's own chrome
// and reads nothing from ../src/styles/. the element's one seed is set on the element itself, which
// is what an integrating page does, and the panel writes no other property on it.
//
// the element is created here rather than in ./index.html, so the document never holds an
// unupgraded one: the registration below is on the same line of module evaluation as the
// `createElement` that follows it. that is why this page carries no `:not(:defined)` reservation
// rule — the box it reserves is a permanent contract with its own height in
// ../src/embed/reservation.ts, and a copy of that number in a page that cannot reach the window it
// covers would be a fifth copy with nothing binding it to the other four.

/** a node ./index.html is expected to be holding, or a sentence naming the one that is missing. */
function need<T extends HTMLElement>(id: string, kind: new () => T): T {
	const node = document.getElementById(id);
	if (!(node instanceof kind)) throw new Error(`./index.html has no ${kind.name} at #${id}`);
	return node;
}

const stage = need('stage', HTMLElement);

defineDonateForm(devRuntime());
const element = document.createElement(DONATE_FORM_TAG);

// --- the seed ---

/** a remembered colour this page will hand an `<input type="color">`, or nothing. */
function hex(value: string | null): string | null {
	return value !== null && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

/**
 * the brand seed: a picker, a clear, and the word saying which of the two the element is on.
 *
 * unset is a state beside the picker rather than inside it, because `<input type="color">` has no
 * empty value — so the swatch goes on showing what pressing it would apply while the element is
 * still drawing its own default. that difference is the point of the whole panel: the unseeded card
 * is grey, and nothing about the swatch says so.
 */
function brandSeed(): void {
	const picker = need('primary', HTMLInputElement);
	const clear = need('primary-clear', HTMLButtonElement);
	const state = need('primary-state', HTMLSpanElement);

	const set = (value: string | null): void => {
		if (value === null) element.style.removeProperty('--donate-primary');
		else {
			picker.value = value;
			element.style.setProperty('--donate-primary', value);
		}
		state.textContent = value ?? 'unset';
		clear.disabled = value === null;
		remember('primary', value);
	};

	picker.addEventListener('input', () => set(picker.value));
	clear.addEventListener('click', () => set(null));
	set(hex(remembered('primary')));
}

brandSeed();

// --- the ground the card is looked at on ---

// the four grounds are `[data-ground]` rules in ./page.css and the radios in ./index.html name them,
// so the markup is the vocabulary and a remembered value that matches no radio simply does not take.
const grounds = [...document.querySelectorAll<HTMLInputElement>('input[name="ground"]')];
for (const radio of grounds) {
	radio.addEventListener('change', () => {
		if (!radio.checked) return;
		stage.dataset.ground = radio.value;
		remember('ground', radio.value);
	});
}

const wantedGround = remembered('ground');
const ground = grounds.find((radio) => radio.value === wantedGround);
if (ground !== undefined) {
	ground.checked = true;
	stage.dataset.ground = ground.value;
}

// --- the configuration served ---

const picker = need('fixture', HTMLSelectElement);
const note = need('fixture-note', HTMLParagraphElement);

for (const name of FIXTURE_NAMES) {
	const option = document.createElement('option');
	option.value = name;
	option.textContent = name;
	picker.append(option);
}

function isFixture(value: string | null): value is FixtureName {
	return FIXTURE_NAMES.some((name) => name === value);
}

function show(name: FixtureName): void {
	note.textContent = FIXTURES[name].note;
	element.setAttribute('form', FIXTURES[name].formId);
}

const wantedFixture = remembered('fixture');
const start: FixtureName = isFixture(wantedFixture) ? wantedFixture : 'default';
picker.value = start;
show(start);

picker.addEventListener('change', () => {
	if (!isFixture(picker.value)) return;
	remember('fixture', picker.value);
	show(picker.value);
});

need('reboot', HTMLButtonElement).addEventListener('click', () => {
	const id = element.getAttribute('form') ?? '';
	// two synchronous writes, because `#bootIfNeeded` in ../src/element.ts drops a boot for the form
	// already live: the empty id in between is what makes the second write a boot rather than a
	// no-op. neither card the first write draws reaches the screen — nothing paints between them.
	element.setAttribute('form', '');
	element.setAttribute('form', id);
});

// last, so the element upgrades once, already carrying its seeds and already told which form it is
// showing. `attributeChangedCallback` returns early while the element is out of the document, so
// everything above this line moved nothing and booted nothing.
stage.append(element);
