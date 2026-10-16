import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// the hosted page and the embed read one token file and come out in different faces.
//
// /donate and a campaign link this sheet after the form's, and the card is in the document, so
// the re-point in ./page.css reaches it. a nonprofit's page links neither sheet: the element
// adopts the form's tokens into its shadow and the platform stack is what computes. both trees
// are in this document so the assertion is the computed face, not a reading of the source.

const require = createRequire(import.meta.url);
const formStyles = dirname(require.resolve('@better-giving/form/styles/tokens.css'));
const tokens = readFileSync(join(formStyles, 'tokens.css'), 'utf8');
const parts = readFileSync(join(formStyles, 'parts.css'), 'utf8');
// the coin list's sheet is not on the form package's export map. the picker adopts it from
// beside the tokens, and the test reads that same file.
const coins = readFileSync(join(formStyles, 'coins.css'), 'utf8');
const page = readFileSync(join(import.meta.dirname, 'page.css'), 'utf8');

function adopt(root: HTMLElement | ShadowRoot, css: string): void {
	const style = document.createElement('style');
	style.textContent = css;
	root.appendChild(style);
}

function face(node: Element): string {
	return getComputedStyle(node).fontFamily;
}

describe('the hosted page is set in Red Hat and the embed is not', () => {
	afterEach(() => {
		document.head.replaceChildren();
		document.body.replaceChildren();
	});

	it('computes Red Hat on the page and the card, and the platform stack in the embed', () => {
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
		adopt(picker, tokens);
		adopt(picker, coins);
		const ticker = document.createElement('span');
		ticker.className = 'coin-ticker';
		ticker.textContent = 'BTC';
		picker.appendChild(ticker);

		const embed = document.createElement('div');
		document.body.appendChild(embed);
		const shadow = embed.attachShadow({ mode: 'open' });
		adopt(shadow, tokens);
		const word = document.createElement('p');
		word.textContent = 'Donate';
		shadow.appendChild(word);

		expect(face(document.getElementById('prose') as Element)).toContain('Red Hat Text');
		expect(face(document.getElementById('title') as Element)).toContain('Red Hat Display');
		expect(face(document.getElementById('heading') as Element)).toContain('Red Hat Display');
		expect(face(document.getElementById('goal') as Element)).toContain('Red Hat Display');
		expect(face(document.getElementById('ask') as Element)).toContain('Red Hat Text');
		const address = document.getElementById('address') as Element;
		expect(face(address)).toContain('Red Hat Mono');
		expect(face(ticker)).toContain('Red Hat Mono');

		const embedded = face(word);
		expect(embedded).toContain('system-ui');
		expect(embedded).not.toContain('Red Hat');
	});
});
