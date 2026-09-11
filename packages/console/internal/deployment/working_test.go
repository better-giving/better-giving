package deployment

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// whether the address a run just registered a name for has started answering.

// an address something answers at, whatever it answers with.
func answeringWith(t *testing.T, status int) string {
	t.Helper()
	at := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	t.Cleanup(at.Close)
	return at.URL
}

// an address nothing answers at: a loopback port taken and given straight back.
func answeringNothing(t *testing.T) string {
	t.Helper()
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no loopback port to take: %v", err)
	}
	at := "http://" + held.Addr().String()
	if err := held.Close(); err != nil {
		t.Fatalf("the port was not given back: %v", err)
	}
	return at
}

// what is being waited on is the address reaching the machine asking, and what the deployment says
// back to an unsigned request is neither this console's question nor a thing it could read.
func TestAnyAnswerAtAllIsTheAddressWorking(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusNotFound} {
		if !Reach(context.Background(), answeringWith(t, status)) {
			t.Errorf("%d was read as nothing answering", status)
		}
	}
}

func TestAnAddressNothingAnswersAtHasNotStartedWorking(t *testing.T) {
	if Reach(context.Background(), answeringNothing(t)) {
		t.Error("an address nothing answers at was read as one that does")
	}
}

// more asks than a bound this short leaves room for, which is an address that never answers.
const nothingInsideTheBound = 1 << 20

// a Reaching that answers nothing until `after` asks have been made, counting every one of them.
func answeringAfter(after int) (Reaching, *int) {
	asked := 0
	return func(context.Context, string) bool {
		asked++
		return asked > after
	}, &asked
}

func TestAnAddressIsAskedAgainUntilItAnswers(t *testing.T) {
	reach, asked := answeringAfter(2)

	if !StartsWorking(context.Background(), reach, "https://give.example", time.Second, time.Millisecond) {
		t.Fatal("an address that came up inside the bound was given up on")
	}
	if *asked != 3 {
		t.Errorf("asked %d times, want the two that found nothing and the one that did", *asked)
	}
}

// the deployment is standing either way, so a bound that elapses is a line and not a failure: what
// this answers is that it had not started working yet, which the caller says and carries on from.
func TestAnAddressThatNeverAnswersIsGivenUpOnAtTheBound(t *testing.T) {
	// an ask that never finds anything, which is the address that has not come up inside the bound.
	reach, asked := answeringAfter(nothingInsideTheBound)

	if StartsWorking(context.Background(), reach, "https://give.example", 20*time.Millisecond, time.Millisecond) {
		t.Fatal("an address nothing answered at was reported as working")
	}
	if *asked < 2 {
		t.Errorf("asked %d times, want an address asked again inside the bound", *asked)
	}
}
