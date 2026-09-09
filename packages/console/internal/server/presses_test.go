package server

import (
	"context"
	"testing"

	"github.com/better-giving/console/internal/deployment"
	"github.com/better-giving/console/internal/stripe"
)

// what a stop is told about the presses this process is holding.
//
// the reason the reading exists at all is that the payments setup outlives the request that starts
// it: a console that went away mid-run leaves the processor account holding an endpoint the
// deployment has no key to verify against, with nothing on the machine saying so.

func TestNothingIsHeldWhereNoPressIsGoing(t *testing.T) {
	presses := &Presses{}
	presses.watch(func() (string, bool) { return "", false })
	presses.watch(func() (string, bool) { return "", false })

	if said, going := presses.Going(); going {
		t.Errorf("going = %q, want a process holding nothing", said)
	}
}

func TestThePressStillGoingIsTheOneAStopIsTold(t *testing.T) {
	presses := &Presses{}
	presses.watch(func() (string, bool) { return "", false })
	presses.watch(func() (string, bool) { return "a deploy is still running (uploading)", true })

	said, going := presses.Going()
	if !going || said != "a deploy is still running (uploading)" {
		t.Errorf("going = %q, %v, want the press this process is holding", said, going)
	}
}

func TestTheProcessorSetupStillGoingIsNamedByTheStageItIsIn(t *testing.T) {
	gate := make(chan struct{})
	runs := &stripe.Runs{}
	if said, going := stripeGoing(runs); going {
		t.Fatalf("going = %q, want nothing before a press", said)
	}

	runs.Start(context.Background(), stripe.Asked{Act: stripe.ActPublish}, stripe.Effects{
		Publish: func(context.Context, map[string]string) deployment.Written {
			<-gate
			return deployment.Written{}
		},
	})

	said, going := stripeGoing(runs)
	if !going || said != "the payments setup is still running (publishing)" {
		t.Errorf("going = %q, %v, want the stage the press is in", said, going)
	}
	close(gate)
}
