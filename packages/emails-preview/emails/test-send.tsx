import { testSend } from '@better-giving/emails';

// the console's "does email work" message, which takes no data — this is the whole of it.
export default function TestSend() {
	return testSend.template().node;
}
