import { invitation } from '@better-giving/emails';

// the invitation as a colleague receives it, on a deployment whose organisation details are
// saved. the case where they are not is the app's: the word this falls back to is applied before
// the template is called, so there is nothing here to show for it.
export default function Invitation() {
	return invitation.template({
		orgName: 'Hope Kitchen',
		link: 'https://give.example/join/1f2e3d4c5b6a798807162534435261708f9e0d1c2b3a49586776859403a2b1c0',
		expiresAt: new Date('2026-01-12T09:00:00Z')
	}).node;
}
