import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// the hosted page computes the self-hosted faces.
//
// /donate and a campaign link this sheet after the form's, and the card is in the document, so
// the re-point in ./page.css reaches it. the coin list adopts the picker's own sheets (parts and
// coins, not the token sheet) and inherits the re-point from its host. what the embed computes,
// and that it requests none of these files, is packages/form/src/embed-faces.browser.spec.ts —
// a stand-in shadow in this document would stay green if the element started asking for a face.

const require = createRequire(import.meta.url);
const formStyles = dirname(require.resolve('@better-giving/form/styles/tokens.css'));
const tokens = readFileSync(join(formStyles, 'tokens.css'), 'utf8');
const parts = readFileSync(join(formStyles, 'parts.css'), 'utf8');
// the coin list's sheet is not on the form package's export map. the picker adopts it from
// beside the tokens, and the test reads that same file.
const coins = readFileSync(join(formStyles, 'coins.css'), 'utf8');
const page = readFileSync(join(import.meta.dirname, 'page.css'), 'utf8');
// happy-dom skips a selector that starts with :host, so :host, [data-donate-root] in
// packages/form/src/styles/tokens.css never sets these two. this sheet is that half.
// happy-dom drops a selector that starts with `:host`, so `--_w-medium` and `--_w-bold` on
// `:host, [data-donate-root]` in packages/form/src/styles/tokens.css never apply in this file.
// this sheet is that half, and nothing else.
const weights = '[data-donate-root] { --_w-medium: 500; --_w-bold: 600; }';

function adopt(root: HTMLElement | ShadowRoot, css: string): void {
	const style = document.createElement('style');
	style.textContent = css;
	root.appendChild(style);
}

function face(node: Element): string {
	return getComputedStyle(node).fontFamily;
}

describe('the hosted page is set in Red Hat', () => {
	afterEach(() => {
		document.head.replaceChildren();
		document.body.replaceChildren();
	});

	it('computes Red Hat on the page and the card', () => {
		adopt(document.head, tokens);
		adopt(document.head, parts);
		adopt(document.head, page);

		const hosted = document.createElement('div');
		hosted.className = 'page';
		hosted.setAttribute('data-donate-root', '');
		hosted.innerHTML = `
			<div class="page-ground">
				<p id="prose">A gift keeps the doors open.</p>
				<h1 class="page-title-heading" id="title">Northside pantry</h1>
				<h2 class="page-heading" id="heading">What your gift does</h2>
				<p class="page-goal-raised" id="goal">$1,200</p>
				<div data-donate-root id="card">
					<p id="ask">Choose an amount</p>
					<p class="value" id="address">TbdBAaeHZo9WeEtpitUFqfEuUXDRfLpjeV</p>
				</div>
			</div>`;
		document.body.appendChild(hosted);

		const pickerHost = document.createElement('div');
		hosted.querySelector('.page-ground')?.appendChild(pickerHost);
		const picker = pickerHost.attachShadow({ mode: 'open' });
		adopt(picker, parts);
		adopt(picker, coins);
		const ticker = document.createElement('span');
		ticker.className = 'coin-ticker';
		ticker.textContent = 'BTC';
		picker.appendChild(ticker);

		expect(face(document.getElementById('prose') as Element)).toContain('Red Hat Text');
		expect(face(document.getElementById('title') as Element)).toContain('Red Hat Display');
		expect(face(document.getElementById('heading') as Element)).toContain('Red Hat Display');
		expect(face(document.getElementById('goal') as Element)).toContain('Red Hat Display');
		expect(face(document.getElementById('ask') as Element)).toContain('Red Hat Text');
		const address = document.getElementById('address') as Element;
		expect(face(address)).toContain('Red Hat Mono');
		expect(face(ticker)).toContain('Red Hat Mono');
	});

	// the figure inside the send sentence. its weight is read off the element, because
	// ./page.spec.ts parses ./page.css and stays green when .value.sent in
	// packages/form/src/styles/parts.css asks for --_w-bold again.
	it('computes the medium weight on the sent figure', () => {
		adopt(document.head, tokens);
		adopt(document.head, parts);
		adopt(document.head, page);
		adopt(document.head, weights);

		const hosted = document.createElement('div');
		hosted.className = 'page';
		hosted.setAttribute('data-donate-root', '');
		hosted.innerHTML = `
			<div class="page-ground">
				<div data-donate-root id="card">
					<span class="value sent" id="sent">0.01 BTC</span>
				</div>
			</div>`;
		document.body.appendChild(hosted);

		const sent = document.getElementById('sent') as Element;
		expect(getComputedStyle(sent).fontWeight).toBe('var(--_w-medium)');
	});
});
