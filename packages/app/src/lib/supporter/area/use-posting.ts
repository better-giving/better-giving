import { useNavigation } from 'react-router';
import { INTENT, type Intent } from './forms';

/**
 * whether this screen's post of `intent` is out: submitting, or its answer still landing. the
 * router keeps the post's body through `loading`, so a press stays held until the screen it led to
 * is drawn rather than re-arming between the answer and the redirect it carries.
 */
export function usePosting(intent: Intent): boolean {
	const navigation = useNavigation();
	return navigation.state !== 'idle' && navigation.formData?.get(INTENT) === intent;
}
