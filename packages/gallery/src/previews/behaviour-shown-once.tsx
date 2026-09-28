import { ShownOnce, useShownOnce } from '@better-giving/operator/behaviour/ShownOnce';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeChip } from '@better-giving/operator/components/data/CodeSlab';
import { useState } from 'react';

/*
 * a secret shown the one time it exists in the clear, in the top layer — so, like
 * ./behaviour-dialog.tsx, it cannot be a resting specimen: a modal standing open would cover every
 * other preview. each press below stands in for an action answering with a new secret.
 *
 * the presses are what the specimen is for. the first makes a key and the card comes up; Done takes
 * it down, and the page still holds the answer it came from — which is what a route holds after the
 * card is dismissed — yet the card stays down, because `useShownOnce` keys off the value that was
 * dismissed rather than off a flag. the second press answers with a different key and the card comes
 * back up with nothing reset. the third is a key long enough to run under the copy control's fade.
 */

const KEYS = [
	'bgk_7Qm2Xc9Lr4Tz8Vh1Nw6Pd3Ks5Yb0EjRa',
	'bgk_4Hn8Wq2Zt6Rv1Lc9Mx3Py7Kb5Ds0FgTe',
	'bgk_9Jd3Fs7Gh1Kl5Zx8Cv2Bn6Mq4We0RtYuIoPaSdFgHjKlZxCvBnMqWeRtYu'
];

export default function BehaviourShownOncePreview() {
	// what an action's answer would hold, and it is never cleared here: a route's is not either.
	const [answer, setAnswer] = useState<{ name: string; key: string } | undefined>(undefined);
	const [shown, done] = useShownOnce(answer?.key);

	return (
		<div className="adm-stack">
			<div className="adm-actions">
				<Button onClick={() => setAnswer({ name: 'Reporting sheet', key: KEYS[0] ?? '' })}>
					Make the first key
				</Button>
				<Button onClick={() => setAnswer({ name: 'Donor wall', key: KEYS[1] ?? '' })}>
					Make a second key
				</Button>
				<Button onClick={() => setAnswer({ name: 'Finance export', key: KEYS[2] ?? '' })}>
					Make a long key
				</Button>
			</div>
			<p>{answer ? `The page still holds the key for ${answer.name}.` : 'No key made yet.'}</p>

			{shown && answer ? (
				<ShownOnce
					title={
						<>
							Copy the key for <CodeChip>{answer.name}</CodeChip>
						</>
					}
					secret={shown}
					copyLabel="Copy the key"
					onDone={done}
				/>
			) : null}
		</div>
	);
}
