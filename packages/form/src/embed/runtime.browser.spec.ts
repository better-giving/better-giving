import { describe, expect, it } from 'vitest';
import { DONATE_FORM_TAG } from '../element';
import { startRuntime } from './runtime';

// the half of the embed's lifecycle a lightweight DOM cannot show.
//
// the snippet puts `<bg-donate-form>` in the org's own HTML and loads the runtime with `async`, so
// the ordinary sequence is: the parser builds an element for a tag nothing has defined yet, and the
// definition arrives afterwards and upgrades it in place. happy-dom does not do that — its
// `customElements.define` performs no upgrade of elements already built and its
// `customElements.upgrade` is a no-op — so ./runtime.dom.spec.ts can only watch an element created
// after registration. this file watches the real order, in a real Chromium.
//
// like every spec in this pool it runs from `pnpm test:browser` and not from `pnpm test`, so it
// does not gate `deploy`; see vitest.browser.config.ts.
//
// no script tag is planted and nothing is fetched. with no runtime script to read an origin off,
// the read refuses by design and the element paints its unavailable card — which is exactly the
// upgrade this is watching for, arriving through the shipped path rather than a stand-in.

describe('the upgrade the snippet actually performs', () => {
	it('upgrades an element the parser had already built', () => {
		document.body.innerHTML = `<${DONATE_FORM_TAG} form="frm_a8x2k9"></${DONATE_FORM_TAG}>`;
		const host = document.body.firstElementChild;
		expect(host?.shadowRoot).toBeNull();

		startRuntime(document);

		expect(host?.shadowRoot).not.toBeNull();
		// by name rather than by position: the element's live region is in front of every card it
		// shows (`#show` in ../element.ts), and it is the card the upgrade is being read off.
		expect(host?.shadowRoot?.querySelector('[part~="card"]')).not.toBeNull();
	});
});
