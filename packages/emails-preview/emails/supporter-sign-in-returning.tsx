import { supporterSignIn } from '@better-giving/emails';

// a returning supporter's sign-in link, on the longest organisation name these previews use, so
// the subject and heading that carry it are seen wrapping.
export default function SupporterSignInReturning() {
	return supporterSignIn.template({
		orgName: 'Harbor Light Community Rescue and Family Services Network',
		link: 'https://give.example.org/fundraise/open?token=Zk3f9QxT7mWb2LpV8aDn5EyH1cRj4uSg',
		signInUrl: 'https://give.example.org/fundraise/sign-in',
		linkLifetimeMs: 60 * 60 * 1000,
		arm: { kind: 'returning' }
	}).node;
}
