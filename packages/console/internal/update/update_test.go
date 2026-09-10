package update

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// github answering with one release, and remembering whether it was asked at all.
type forge struct {
	asked int
	tag   string
	fails int
	body  string
}

func (held *forge) get(t *testing.T) cf.Get {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		held.asked++
		if held.fails != 0 {
			w.WriteHeader(held.fails)
			return
		}
		if held.body != "" {
			_, _ = w.Write([]byte(held.body))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": held.tag})
	}))
	t.Cleanup(server.Close)
	return cf.JSONGet(server.URL, nil)
}

func TestAReleaseNewerThanThisBinaryIsSaidSoAndNamesWhereToInstallIt(t *testing.T) {
	held := &forge{tag: "v0.4.0"}
	read := Latest(context.Background(), held.get(t), "0.3.9")

	if read.Kind != Newer || read.Version != "0.4.0" {
		t.Fatalf("read = %+v, want the newer release named", read)
	}
	if read.Where == "" {
		t.Error("nothing says where to install it, which is the whole of what this reading is for")
	}
}

func TestTheReleaseThisBinaryWasCutInIsCurrent(t *testing.T) {
	held := &forge{tag: "v0.3.9"}
	if read := Latest(context.Background(), held.get(t), "0.3.9"); read.Kind != Current {
		t.Errorf("read = %+v, want %q", read, Current)
	}
}

func TestAnOlderLatestIsCurrentRatherThanNewer(t *testing.T) {
	// a binary built past the last release — a contributor's, or one cut from a tag github has not
	// published yet. nothing about it is an update to install.
	held := &forge{tag: "v0.3.0"}
	if read := Latest(context.Background(), held.get(t), "0.10.0"); read.Kind != Current {
		t.Errorf("read = %+v, want %q", read, Current)
	}
}

func TestVersionsAreComparedAsNumbersRatherThanAsWords(t *testing.T) {
	// `0.9.0` sorts after `0.10.0` as a word, which is a console that never mentions the update.
	held := &forge{tag: "v0.10.0"}
	if read := Latest(context.Background(), held.get(t), "0.9.0"); read.Kind != Newer {
		t.Errorf("read = %+v, want %q", read, Newer)
	}
}

func TestAGithubThatAnsweredNothingIsUnknownAndNeverAnError(t *testing.T) {
	// the machine is offline, or github is down: an operator is told nothing about updates, and
	// every press on the screen still works.
	held := &forge{fails: http.StatusInternalServerError}
	if read := Latest(context.Background(), held.get(t), "0.3.9"); read.Kind != Unknown {
		t.Errorf("read = %+v, want %q", read, Unknown)
	}
}

func TestAnAnswerInAShapeThisWasNotWrittenAgainstIsUnknown(t *testing.T) {
	held := &forge{body: `{"name":"the latest one"}`}
	if read := Latest(context.Background(), held.get(t), "0.3.9"); read.Kind != Unknown {
		t.Errorf("read = %+v, want %q", read, Unknown)
	}
}

func TestATagThatIsNotAVersionIsUnknown(t *testing.T) {
	held := &forge{tag: "nightly"}
	if read := Latest(context.Background(), held.get(t), "0.3.9"); read.Kind != Unknown {
		t.Errorf("read = %+v, want %q", read, Unknown)
	}
}

func TestABinaryCarryingNoVersionAsksGithubNothing(t *testing.T) {
	// what a `go build` here leaves, which is every contributor's binary: there is no release to be
	// behind, so the reading is unknown before any call is made.
	held := &forge{tag: "v9.9.9"}
	read := Latest(context.Background(), held.get(t), "dev")
	if read.Kind != Unknown {
		t.Errorf("read = %+v, want %q", read, Unknown)
	}
	if held.asked != 0 {
		t.Errorf("github was asked %d times, want none", held.asked)
	}
}

func TestAPreReleaseIsBehindALaterPreReleaseOfTheSameNumbers(t *testing.T) {
	held := &forge{tag: "v0.0.1-alpha.3"}
	if read := Latest(context.Background(), held.get(t), "0.0.1-alpha.2"); read.Kind != Newer {
		t.Errorf("read = %+v, want %q", read, Newer)
	}
}

func TestAPreReleaseIsBehindThePlainReleaseOfItsOwnNumbers(t *testing.T) {
	held := &forge{tag: "v0.0.1"}
	if read := Latest(context.Background(), held.get(t), "0.0.1-alpha.3"); read.Kind != Newer {
		t.Errorf("read = %+v, want %q", read, Newer)
	}
}

func TestAPlainReleaseIsNotBehindItsOwnPreReleases(t *testing.T) {
	held := &forge{tag: "v0.0.1-alpha.3"}
	if read := Latest(context.Background(), held.get(t), "0.0.1"); read.Kind != Current {
		t.Errorf("read = %+v, want %q", read, Current)
	}
}

func TestAPlainReleaseIsBehindALaterVersionsPreRelease(t *testing.T) {
	held := &forge{tag: "v0.0.2-alpha.1"}
	if read := Latest(context.Background(), held.get(t), "0.0.1"); read.Kind != Newer {
		t.Errorf("read = %+v, want %q", read, Newer)
	}
}

func TestThePreReleaseThisBinaryWasCutInIsCurrent(t *testing.T) {
	held := &forge{tag: "v0.0.1-alpha.3"}
	if read := Latest(context.Background(), held.get(t), "0.0.1-alpha.3"); read.Kind != Current {
		t.Errorf("read = %+v, want %q", read, Current)
	}
}

func TestATagsLeadingVIsNoPartOfTheVersion(t *testing.T) {
	for _, tag := range []string{"v0.0.1-alpha.3", "0.0.1-alpha.3"} {
		t.Run(tag, func(t *testing.T) {
			held := &forge{tag: tag}
			read := Latest(context.Background(), held.get(t), "0.0.1-alpha.2")
			if read.Kind != Newer || read.Version != "0.0.1-alpha.3" {
				t.Errorf("read = %+v, want the newer release named without its `v`", read)
			}
		})
	}
}

func TestAVersionStatingFewerPartsThanTheOtherIsTheSameRelease(t *testing.T) {
	for _, both := range []struct{ tag, mine string }{
		{tag: "v0.4.0", mine: "0.4"},
		{tag: "v0.4", mine: "0.4.0"},
	} {
		t.Run(both.tag+" against "+both.mine, func(t *testing.T) {
			held := &forge{tag: both.tag}
			if read := Latest(context.Background(), held.get(t), both.mine); read.Kind != Current {
				t.Errorf("read = %+v, want %q", read, Current)
			}
		})
	}
}

func TestABuildSuffixIsNoPartOfTheOrdering(t *testing.T) {
	for _, both := range []struct {
		tag, mine string
		want      Kind
	}{
		{tag: "v0.0.1+beef", mine: "0.0.1+cafe", want: Current},
		{tag: "v0.0.1-alpha.3", mine: "0.0.1-alpha.2+cafe", want: Newer},
		{tag: "v0.0.1-alpha.3+beef", mine: "0.0.1", want: Current},
	} {
		t.Run(both.tag+" against "+both.mine, func(t *testing.T) {
			held := &forge{tag: both.tag}
			if read := Latest(context.Background(), held.get(t), both.mine); read.Kind != both.want {
				t.Errorf("read = %+v, want %q", read, both.want)
			}
		})
	}
}

func TestABinaryCarryingSomethingThatIsNotAVersionAsksGithubNothing(t *testing.T) {
	for _, mine := range []string{"dev", "", "nightly", "v", "0.0.1.2", "0.0.1-"} {
		t.Run(mine, func(t *testing.T) {
			held := &forge{tag: "v9.9.9"}
			if read := Latest(context.Background(), held.get(t), mine); read.Kind != Unknown {
				t.Errorf("read = %+v, want %q", read, Unknown)
			}
			if held.asked != 0 {
				t.Errorf("github was asked %d times, want none", held.asked)
			}
		})
	}
}
