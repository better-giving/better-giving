import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { describe, expect, it } from 'vitest';
import { loader } from './donate';

// see ./_index.db.spec.ts for the page this address forwards to, and for a donor arriving back
// from authorizing a gift through it.

const OWN = 'https://give.example.org';

const forwarded = (search: string) =>
	loader({ request: new Request(`${OWN}/donate${search}`) } as Parameters<typeof loader>[0]);

describe('/donate', () => {
	it('forwards for good to the donation page at the home address', () => {
		const response = forwarded('');

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/');
	});

	it('keeps the query string, as a link already shared carries it', () => {
		const response = forwarded('?x=1&utm_source=mail');

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/?x=1&utm_source=mail');
	});

	it('keeps the stamp a donor returning from authorizing a gift arrives with', () => {
		const response = forwarded(`?${RESUME_FORM_PARAM}=frm_donorpage000001&token=abc`);

		expect(response.headers.get('location')).toBe(
			`/?${RESUME_FORM_PARAM}=frm_donorpage000001&token=abc`
		);
	});
});
