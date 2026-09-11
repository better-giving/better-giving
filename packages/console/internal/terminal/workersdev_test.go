package terminal

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/deployment"
)

func TestANameCloudflareWouldNotTakeIsRefusedAtTheBoxAndNeverSent(t *testing.T) {
	// the shape is cloudflare's own (../deployment's NameUsable), restated at the box so that a
	// name typed here is one the registration can land — a box that took anything would send an
	// operator's typo to cloudflare to be refused a second time.
	for _, typed := range []string{"", "Hound Haven", "-hound", "hound-", strings.Repeat("a", 64)} {
		refused := namingRefusal(typed)
		if refused == nil {
			t.Errorf("%q was not refused", typed)
			continue
		}
		if !strings.Contains(refused.Error(), "hyphens") {
			t.Errorf("%q was refused with %q, which says nothing about the shape",
				typed, refused.Error())
		}
	}
	if refused := namingRefusal("hound-haven"); refused != nil {
		t.Errorf("a name cloudflare takes was refused with %v", refused)
	}
	// and the rule itself is the one ../deployment holds, rather than a second reading of it.
	if deployment.NameUsable("hound.haven") {
		t.Fatal("the shape this box restates is not the one cloudflare takes")
	}
}

func TestNoNameIsAskedForWhereThereIsNobodyToAskIt(t *testing.T) {
	typed, given, err := AskWorkersDevName(strings.NewReader("hound-haven\n"), io.Discard, "")
	if given || typed != "" {
		t.Errorf("AskWorkersDevName = %q, %v", typed, given)
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskWorkersDevName refused a pipe with %v, want %v", err, ErrNoTerminal)
	}
	if !strings.Contains(err.Error(), "workers.dev") {
		t.Errorf("refused with %q, which does not name the question that stopped the press",
			err.Error())
	}
}

func TestWhyTheNameIsBeingAskedForIsDrawnOnTheQuestionsOwnScreen(t *testing.T) {
	// the operator is only ever asked because cloudflare turned a name down, so the question that
	// arrives with nothing above it is one they have no way to answer better than the last time.
	held := &bytes.Buffer{}
	preamble := "Cloudflare will not take hound-haven: it is another account's"

	_, given, err := AskWorkersDevName(strings.NewReader("anything\n"), held, preamble)

	if given {
		t.Error("a pipe was asked for a name")
	}
	if !errors.Is(err, ErrNoTerminal) {
		t.Errorf("AskWorkersDevName = %v, want %v", err, ErrNoTerminal)
	}
	if !strings.Contains(held.String(), preamble) {
		t.Errorf("said %q, want why this question is being put", held.String())
	}
}
