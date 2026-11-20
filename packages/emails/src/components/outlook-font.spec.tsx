import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import { FONT_MONO, FONT_SANS, OUTLOOK_MONO, OUTLOOK_SANS } from '../tokens';
import * as receipt from '../templates/receipt';

// Outlook for Windows reads the first name of a font-family list and sets Times New Roman when
// that face is not installed, so the shared shell carries a block only it reads
// (./layout.tsx, OUTLOOK_FONT_BLOCK). this holds it on a receipt, the template a donor keeps.

const MESSAGE = renderEmail(
	receipt.template({
		org: {
			legalName: 'Hope Foundation',
			taxId: '12-3456789',
			addressLine1: '1 Charity Way',
			addressLine2: null,
			city: 'Springfield',
			region: 'IL',
			postalCode: '62701',
			country: 'United States'
		},
		donorName: 'Ada Lovelace',
		contribution: {
			totalMinor: 10_000,
			nonDeductibleMinor: 0,
			currency: 'USD',
			receivedAt: new Date('2026-01-05T12:00:00Z')
		},
		goodsOrServices: { kind: 'none' },
		tribute: null,
		program: null,
		crypto: null
	})
);

/** the conditional comment, whole, as a client receives it. */
function outlookBlock(html: string): string {
	const open = html.indexOf('<!--[if mso]>');
	return html.slice(open, html.indexOf('<![endif]-->', open) + '<![endif]-->'.length);
}

describe('the Outlook font fallback', () => {
	it('puts an mso-only style block in the head of a receipt, naming Arial and Consolas', async () => {
		const { html } = await MESSAGE;
		const block = outlookBlock(html);
		const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
		expect(head).toContain(block);
		expect(block).toMatch(/^<!--\[if mso\]><style>.*<\/style><!\[endif\]-->$/);
		expect(block).toContain(`font-family:${OUTLOOK_SANS} !important`);
		expect(block).toContain(`font-family:${OUTLOOK_MONO} !important`);
		expect(block).toContain('mso-font-alt:Arial');
		expect(OUTLOOK_SANS).toBe('Arial, sans-serif');
		expect(OUTLOOK_MONO).toBe("Consolas, 'Courier New', monospace");
	});

	it('adds no web font and no link', async () => {
		const block = outlookBlock((await MESSAGE).html);
		expect(block).not.toMatch(/@font-face|@import|url\(|https?:|<link/i);
		expect((await MESSAGE).html).not.toMatch(/<link|@font-face/i);
	});

	it('leaves the font-family every other client reads as it was', async () => {
		const { html } = await MESSAGE;
		// outside the conditional comment, so what a non-Outlook client sees.
		const visible = html.replace(outlookBlock(html), '');
		expect(visible).not.toContain('Arial');
		expect(visible).not.toContain('<style');
		const sans = FONT_SANS.replaceAll("'", '&#x27;');
		const mono = FONT_MONO.replaceAll("'", '&#x27;');
		expect(visible).toContain(`font-family:${sans}`);
		expect(visible).toContain(`font-family:${mono}`);
	});

	it('keeps the title, escaped, in the head beside the block', async () => {
		const { html, subject } = await MESSAGE;
		const title = /<title>(.*?)<\/title>/.exec(html)?.[1];
		expect(title).toBeDefined();
		expect(title?.replaceAll('&#x27;', "'").replaceAll('&amp;', '&')).toBe(subject);
	});

	it('does not reach the plain-text arm', async () => {
		const { text } = await MESSAGE;
		expect(text).not.toMatch(/Arial|Consolas|font-family|mso/);
	});
});
