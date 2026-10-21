import { describe, expect, it } from 'vitest';
import { FILL_IN_ORG_DETAILS, TEST_THE_SMTP_SETTINGS } from './alert';

// an alert goes to the notification address, which members read, and Settings answers a member's
// session with not-found (../../../routes/_app.admin.settings.tsx). so an action that starts in
// Settings says who to ask, as the go-live block words it for a member ($lib/admin/forms/readiness.tsx).

describe.each([
	['missing organisation details', FILL_IN_ORG_DETAILS],
	['a mail test', TEST_THE_SMTP_SETTINGS]
])('the alert action for %s', (_, action) => {
	it('sends a reader who can’t open Settings to whoever set up this site', () => {
		expect(action).toContain('Settings');
		expect(action).toContain('If you can’t open Settings, ask whoever set up this site');
	});
});
