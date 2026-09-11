package deployment

import (
	"context"
	"testing"
)

// the release the console last put on the deployment, read back off the worker it was written onto.
//
// it is read with the cloudflare sign-in and never over the deployment's own console surface, which
// is the whole of why it exists: a machine that has never connected a console to this deployment
// holds no session for it, and that machine is exactly the one `better-giving start` is run on.

func recorded(t *testing.T, answer any) string {
	t.Helper()
	return RecordedRelease(context.Background(),
		fake(t, map[string]any{settings: answer}), account, worker)
}

func TestTheReleaseTheConsoleRecordedIsReadBackOffTheWorker(t *testing.T) {
	held := recorded(t, envelope(map[string]any{"bindings": []any{
		map[string]any{"name": "STRIPE_SECRET_KEY", "type": "plain_text", "text": "sk_live_x"},
		map[string]any{"name": RecordedReleaseName, "type": "plain_text", "text": "1.4.0"},
	}}))

	if held != "1.4.0" {
		t.Errorf("RecordedRelease = %q, want the release the console recorded", held)
	}
}

func TestADeploymentCarryingNoRecordOfItsReleaseAnswersNothing(t *testing.T) {
	// every deployment put up before the console recorded one, which is what the session read is
	// still there for (../effects' OwnRelease).
	if held := recorded(t, envelope(map[string]any{"bindings": []any{}})); held != "" {
		t.Errorf("RecordedRelease = %q, want a deployment carrying no record read as unknown", held)
	}
}

func TestARecordThisConsoleCannotReadAValueOutOfIsNoRecord(t *testing.T) {
	// a name under any other binding type is one this console cannot read, and a value that trims to
	// nothing is what the deployment itself makes of a blank (./values.go's toVar).
	for _, binding := range []map[string]any{
		{"name": RecordedReleaseName, "type": "secret_text"},
		{"name": RecordedReleaseName, "type": "plain_text", "text": "   "},
	} {
		held := recorded(t, envelope(map[string]any{"bindings": []any{binding}}))
		if held != "" {
			t.Errorf("a %s record read as %q, want a record with no release in it read as none",
				binding["type"], held)
		}
	}
}

func TestAReadThatDidNotLandRecordsNothingEitherWay(t *testing.T) {
	// a worker that is not there is every run before a first deploy; a refusal and a shape nothing
	// was written against are the other two, and none of the three found anything out.
	for _, answer := range []any{
		failed(10007, "script not found"),
		failed(9109, "invalid access token"),
		envelope(map[string]any{"bindings": "none"}),
	} {
		if held := recorded(t, answer); held != "" {
			t.Errorf("a read that did not land answered %q", held)
		}
	}
}
