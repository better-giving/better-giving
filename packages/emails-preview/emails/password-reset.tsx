import { passwordReset } from '@better-giving/emails';

// the reset link as a member receives it, on a deployment whose organisation details are saved.
// the case where they are not is the app's: the word this falls back to is applied before the
// template is called, so there is nothing here to show for it.
export default function PasswordReset() {
	return passwordReset.template({
		orgName: 'Hope Kitchen',
		link: 'https://give.example/reset?token=1f2e3d4c5b6a79880716253443526170'
	}).node;
}
