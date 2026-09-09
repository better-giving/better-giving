import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRE_UPGRADE_RESERVATION, RESERVED_MIN_HEIGHT } from './embed/reservation';
import { part, partWhen, PART_NAMES, ROLE_TOKENS, SLOT_NAMES, STATE_TOKENS } from './parts';

// node pool: this is a comparison between two lists and needs no DOM at all. the assertion that
// the element only ever emits names from this list is a `*.dom.spec.ts`, because that one needs
// a rendered shadow root to walk.

type Manifest = {
	modules: {
		declarations: {
			tagName?: string;
			description?: string;
			cssParts?: { name: string; description?: string }[];
			cssProperties?: { name: string; syntax?: string; default?: string }[];
			attributes?: { name: string }[];
			slots?: { name: string }[];
		}[];
	}[];
};

const manifest = JSON.parse(
	readFileSync(new URL('../custom-elements.json', import.meta.url), 'utf8')
) as Manifest;

const element = manifest.modules
	.flatMap((module) => module.declarations)
	.find((declaration) => declaration.tagName === 'bg-donate-form');

const publishedSeeds = Object.fromEntries(
	(element?.cssProperties ?? []).map((property) => [property.name, property])
);

// whitespace and nothing else. a color spelled two ways is two strings here, because the claim
// under test is that the published string is the shipped string — a comparison that resolved
// either side would go on passing while an integrator read a value the element never computes.
const squash = (value: string) => value.trim().replace(/\s+/g, ' ');

type Registration = { syntax: string; initialValue: string | undefined };

// comments are stripped before the sheet is scanned: ./styles/tokens.css explains `@property` in
// prose above the rules, and prose naming the at-rule is not a registration.
const registeredSeeds: Record<string, Registration> = {};

for (const match of readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8')
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.matchAll(/@property\s+(--donate-[\w-]+)\s*\{([^}]*)\}/g)) {
	const [, name, body] = match;
	// both groups are mandatory in the pattern above, so a match carries both. the throw is what
	// keeps a later edit to the pattern from turning a seed it stopped reading into one silently
	// absent from the list, which is the drift these comparisons exist to catch.
	if (name === undefined || body === undefined) {
		throw new Error(`@property rule read without a name and a body: ${match[0]}`);
	}
	const initialValue = body.match(/initial-value:\s*([^;]+);/)?.[1];

	registeredSeeds[name] = {
		syntax: squash(body.match(/syntax:\s*'([^']*)'/)?.[1] ?? ''),
		initialValue: initialValue === undefined ? undefined : squash(initialValue)
	};
}

// every token the element can put on a part, read from the two builders in ./parts.ts that are the
// only way one reaches an attribute. the comparisons below hold the manifest's *name* lists against
// the code; a token is claimed in a part's description instead, which is prose no list reads — so a
// token documented on a part and emitted by nothing passes every other assertion in this file.
const emittedTokens = new Set<string>();

for (const file of readdirSync(new URL('./', import.meta.url), {
	recursive: true,
	encoding: 'utf8'
})) {
	if (!file.endsWith('.ts') || file.includes('.spec.')) continue;

	const source = readFileSync(new URL(file, new URL('./', import.meta.url)), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		// the `[^:]` keeps a `https://` inside a string from being read as a comment.
		.replace(/(^|[^:])\/\/.*$/gm, '$1');

	// `part(name, 'a', 'b')`: every quoted argument after the name is a token. prose naming
	// `::part(action)` survives the strip above and matches here, and carries no quoted argument.
	for (const [, args] of source.matchAll(/\bpart\(([^)]*)\)/g)) {
		for (const [, token] of [...(args ?? '').matchAll(/'([^']*)'/g)].slice(1)) {
			if (token !== undefined) emittedTokens.add(token);
		}
	}

	// `partWhen(name, { a: cond, b })`: every key is a token the call can emit, whether or not the
	// condition holds at runtime. a key is kept only when it is one of the declared tokens, so a
	// value split across a comma contributes nothing.
	for (const [, body] of source.matchAll(/\bpartWhen\([^,]*,\s*\{([^}]*)\}/g)) {
		for (const entry of (body ?? '').split(',')) {
			const key = entry.split(':')[0]?.trim() ?? '';
			if (([...STATE_TOKENS, ...ROLE_TOKENS] as readonly string[]).includes(key)) {
				emittedTokens.add(key);
			}
		}
	}
}

// a sentence saying a part never takes a token is the opposite of a claim that it does, and
// `action` carries one about `disabled`.
const documentedTokens = (element?.cssParts ?? []).map((cssPart) => ({
	name: cssPart.name,
	tokens: [
		...(cssPart.description ?? '').replace(/Never takes[^.]*\./g, '').matchAll(/`([\w-]+)`/g)
	]
		.map(([, token]) => token ?? '')
		.filter((token) => (STATE_TOKENS as readonly string[]).includes(token))
}));

describe('the part vocabulary', () => {
	it('is twelve names, and a thirteenth is a decision rather than an edit', () => {
		// the number is asserted on purpose. every name is permanent the day it ships, so growing
		// the list has to be something a reader of the diff cannot miss. it went 13 → 12 once, when
		// the identity footer left the card and `legal` went with it — the one withdrawal, argued at
		// the top of ./parts.ts and available only while nothing is deployed.
		expect(PART_NAMES).toHaveLength(12);
	});

	it('holds no duplicate name', () => {
		expect(new Set(PART_NAMES).size).toBe(PART_NAMES.length);
	});

	it('declares no state a part can never be in', () => {
		// a token nothing emits is a state a host writes a rule for and never sees fire, and it is
		// permanent the day it is published — so it costs an integrator a rule that silently does
		// nothing and costs this repository a name it may not withdraw twice.
		expect(STATE_TOKENS.filter((token) => !emittedTokens.has(token))).toEqual([]);
	});

	it('never spells a state or a role as a name', () => {
		// the rule that keeps the list small: `part="amount-option selected"`, never a part called
		// `amount-option-selected`. a name that collides with a token would make `::part(selected)`
		// match a surface as well as a state.
		const names: readonly string[] = PART_NAMES;
		const tokens = [...STATE_TOKENS, ...ROLE_TOKENS];

		expect(tokens.filter((token) => names.includes(token))).toEqual([]);
	});

	it('names no layout container and no semantic-color surface', () => {
		// the absent names are the enforcement. a host's normal declaration beats an inner one
		// across the boundary, so naming the tile grid hands over the layout that holds the 375px
		// floor, and naming the error banner hands back exactly what "semantic color is legibility,
		// not brand" took away.
		const names: readonly string[] = PART_NAMES;
		const refused = [
			'grid',
			'row',
			'step',
			'amount-grid',
			'frequency-group',
			'error',
			'success',
			'banner',
			'divider',
			'icon',
			'spinner',
			'badge',
			'wallet',
			'skeleton'
		];

		expect(refused.filter((name) => names.includes(name))).toEqual([]);
	});
});

describe('the published manifest', () => {
	it('lists exactly the names the code emits', () => {
		// `custom-elements.json` is the copy an integrator reads, and it is the contract rather
		// than the docs, because the vocabulary is unguessable. a name added in one place and not
		// the other fails here rather than being discovered by a host whose rule does nothing.
		const published = (element?.cssParts ?? []).map((cssPart) => cssPart.name);

		expect(published.sort()).toEqual([...PART_NAMES].sort());
	});

	it('claims no state on a part that the element never puts on it', () => {
		// the descriptions are where the states are published, and nothing else in this file reads
		// them: the assertions around it compare name lists, so a state claimed in prose and emitted
		// by nothing would be invisible to all of them.
		const unemitted = documentedTokens.flatMap(({ name, tokens }) =>
			tokens.filter((token) => !emittedTokens.has(token)).map((token) => `${name}: ${token}`)
		);

		expect(unemitted).toEqual([]);
	});

	it('publishes the one seed and no second', () => {
		const published = (element?.cssProperties ?? []).map((property) => property.name);

		expect(published).toEqual(['--donate-primary']);
	});

	it('names the same seeds the stylesheet registers, in both directions', () => {
		// the sheet is where a seed becomes real and the manifest is where an integrator learns it
		// exists. read one way this catches a documented seed nothing registers, whose value a host
		// sets and the element never reads; read the other, a registered seed nobody was told about.
		expect(Object.keys(publishedSeeds).sort()).toEqual(Object.keys(registeredSeeds).sort());
	});

	it('publishes each seed default as the string the stylesheet registers', () => {
		// the `default` an integrator reads is the `initial-value` that computes when they seed
		// nothing, so the two are one value written twice and only this holds them together.
		const registered: Record<string, string> = {};
		const published: Record<string, string> = {};

		for (const [name, registration] of Object.entries(registeredSeeds)) {
			if (registration.initialValue === undefined) continue;

			registered[name] = registration.initialValue;
			published[name] = squash(publishedSeeds[name]?.default ?? '');
		}

		expect(published).toEqual(registered);
	});

	it('registers every seed with an initial value', () => {
		// the comparison above is what holds the manifest's published default to the sheet's own
		// registration, and it can only make it for a seed that has one. a seed registered without
		// an `initial-value` is also a seed left unvalidated — `@property` drops the whole block —
		// so an absence here is two failures rather than an untested default.
		const withoutInitialValue = Object.entries(registeredSeeds)
			.filter(([, registration]) => registration.initialValue === undefined)
			.map(([name]) => name);

		expect(withoutInitialValue).toEqual([]);
	});

	it('publishes each seed syntax as the stylesheet registers it', () => {
		// the syntax is what a host's malformed value is rejected against, so a manifest promising
		// `<color>` where the sheet accepts `*` documents a guarantee the element does not make.
		const registered = Object.fromEntries(
			Object.entries(registeredSeeds).map(([name, registration]) => [name, registration.syntax])
		);
		const published = Object.fromEntries(
			Object.keys(registeredSeeds).map((name) => [name, publishedSeeds[name]?.syntax])
		);

		expect(published).toEqual(registered);
	});

	it('publishes the two attributes and no third', () => {
		const published = (element?.attributes ?? []).map((attribute) => attribute.name);

		expect(published.sort()).toEqual(['form', 'variant']);
	});

	// a slot name is as permanent as a part name and as unguessable: a host writing `slot="loading"`
	// is writing against this list. the `payment` name is on it because the element projects its own
	// light DOM through it, which is observable from the host's page whether or not they use it.
	it('lists exactly the slot names the element projects through', () => {
		const published = (element?.slots ?? []).map((slot) => slot.name);

		expect(published.sort()).toEqual([...SLOT_NAMES].sort());
	});
});

// the element is an unknown inline element until its script has run, and the snippet loads that
// script `async` — so the parser builds the element, lays the host's page out around a box of no
// size, and reflows the whole page by the card's full height when the definition lands. nothing the
// script does can fix that: it has to run to inject anything, and by then the upgrade has happened.
// so the reservation is published rather than injected, and these are the two ends it has to hold
// together — a host page's rule against a sheet that is only adopted after the upgrade it precedes.
describe('the reservation a host page holds before the element upgrades', () => {
	const layout = readFileSync(new URL('./styles/layout.css', import.meta.url), 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		''
	);
	const block = (selector: string): string =>
		squash(layout.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '');
	// `:host([hidden])` and the rest are left out by the brace: this is the block that dresses the
	// element's own box. the floor is not on it — it belongs to the one card that reserves rather
	// than measures, which is the wait.
	const hostBlock = block(':host');
	const loadingBlock = block('\\.loading');

	it('reserves exactly the height the element’s own sheet holds after it', () => {
		// one number written in two files that no cascade ever brings together — the sheet is adopted
		// into a shadow root the host page cannot see, and the rule is in a document the sheet cannot
		// reach. changed on either side alone, the page reflows by the difference on every load.
		expect(loadingBlock).toContain(`min-height: ${RESERVED_MIN_HEIGHT}`);
		expect(PRE_UPGRADE_RESERVATION).toContain(`min-height: ${RESERVED_MIN_HEIGHT}`);
	});

	// and the element's own floor ends with the wait rather than outliving it. held on `:host` it
	// applies to every card the element ever draws, so a short step is stretched to a guess at the
	// tallest one — see `.loading` in ./styles/layout.css, and "lets the card size to its own
	// content once there is a card" in ./element.browser.spec.ts, which measures it.
	it('puts that floor under the wait alone, not under every card that follows it', () => {
		expect(hostBlock).not.toContain('min-height');
		expect(hostBlock).not.toContain('min-block-size');
	});

	it('lays the box out the way the element lays its own out', () => {
		// a custom element is `display: inline` until told otherwise, and a `min-height` on an inline
		// box does nothing at all — so the reservation reserves nothing without this half of it.
		expect(hostBlock).toContain('display: block');
		expect(PRE_UPGRADE_RESERVATION).toContain('display: block');
	});

	it('names the element under the tag the manifest publishes', () => {
		expect(PRE_UPGRADE_RESERVATION).toContain(`${element?.tagName}:not(:defined)`);
	});

	// the manifest is the integration contract an integrator reads, and a reservation nobody is told
	// about is one nobody pastes.
	it('is recorded in the published manifest', () => {
		expect(element?.description).toContain(':not(:defined)');
		expect(element?.description).toContain(RESERVED_MIN_HEIGHT);
	});

	// README.md and DEPLOY.md are held to this reservation in scripts/embed-snippet.spec.ts, not
	// here — nothing under packages/form/** reads outside its own tree.
});

describe('the part builder', () => {
	it('writes a bare name when there is no state to report', () => {
		expect(part('card')).toBe('card');
	});

	it('appends tokens to the name they qualify', () => {
		expect(part('action', 'submit', 'busy')).toBe('action submit busy');
	});

	it('keeps only the tokens whose condition holds', () => {
		expect(partWhen('amount-option', { selected: true, invalid: false })).toBe(
			'amount-option selected'
		);
	});

	it('drops every token when none holds', () => {
		expect(partWhen('amount-option', { selected: false, invalid: false })).toBe('amount-option');
	});
});
