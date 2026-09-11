package deployment

import (
	"context"
	"strings"

	"github.com/better-giving/console/internal/cf"
)

// the release this console last put on the deployment, recorded on the worker by the act that
// uploaded it.
//
// **it is the console's own record about the deployment and is not a configuration value.** the
// thirteen are what an operator sets and what every screen draws (./values.go); this is a note the
// console wrote to itself, on no enumeration and drawn as configuration nowhere — which is the
// reading ./write.go's ConsoleTokenName already argues for the one Worker secret (CLAUDE.md →
// Boundaries). ./values.go drops a name off the enumeration, so this is read on its own.
//
// **it is written by the upload and read with the cloudflare sign-in, and that is the whole point
// of it.** what a deployment says about itself is read over a session the console holds for that
// origin (../effects' OwnRelease), and the machine a `better-giving start` is run on may never have
// connected a console to it — so there was no release on the screen and no way to tell a deployment
// already on this one. the sign-in that is about to deploy reads the worker's own settings instead,
// which every run of that command holds by the time it asks.
//
// **it can never disagree with what is running, because one act writes both** (../deploy/upload.go
// puts it in the same metadata as the modules). a deploy that stopped before the upload recorded
// nothing, and a deploy that landed recorded what landed.

// RecordedReleaseName is the name the record is held under on the worker.
const RecordedReleaseName = "CONSOLE_RELEASE"

// RecordedRelease is the release this console last uploaded onto `workerName` in `accountID`, and
// empty where there is no record of one.
//
// **empty is every way of not finding out and they are one thing to do about it**: a deployment put
// up before this console recorded anything, a read that did not land, and a record this console
// cannot read a value out of are each a caller that has to ask somewhere else (../effects'
// OwnRelease) or ask the operator.
func RecordedRelease(ctx context.Context, get cf.Get, accountID, workerName string) string {
	read := cf.ReadShaped(get(ctx, settingsPath(accountID, workerName)), func(value any) ([]any, bool) {
		held, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		bindings, listed := held["bindings"].([]any)
		return bindings, listed
	})
	if read.Kind != cf.ResultValue {
		return ""
	}

	for _, binding := range read.Value {
		row, ok := binding.(map[string]any)
		if !ok || row["name"] != RecordedReleaseName || row["type"] != "plain_text" {
			continue
		}
		text, _ := row["text"].(string)
		return strings.TrimSpace(text)
	}
	return ""
}
