package deployment

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/better-giving/console/internal/cf"
)

// the name derived from the cloudflare account's own, which is what is tried before anything is
// asked.
func TestANameIsDerivedFromTheAccountsOwnAndHeldToWhatCloudflareTakes(t *testing.T) {
	for _, one := range []struct{ what, account, want string }{
		{"an ordinary account name", "Hound Haven", "hound-haven"},
		{"punctuation and case", "ACME, Inc.", "acme-inc"},
		{"runs of anything unusable collapsed", "Hound  --  Haven", "hound-haven"},
		{"a name that would start and end on a hyphen", " -Hound Haven- ", "hound-haven"},
		{"an email an account is named after", "o@hound.haven", "o-hound-haven"},
		{"digits kept", "Hound Haven 2", "hound-haven-2"},
		{"a name longer than a label may be", strings.Repeat("a", 70), strings.Repeat("a", 63)},
		{"a truncation landing on a hyphen", strings.Repeat("a", 62) + " haven", strings.Repeat("a", 62)},
		{"a name with nothing usable in it", "日本", ""},
		{"no name at all", "", ""},
	} {
		if got := DerivedName(one.account); got != one.want {
			t.Errorf("%s: DerivedName(%q) = %q, want %q", one.what, one.account, got, one.want)
		}
	}
}

// the shape cloudflare will take, which is what a typed name is held to before it is sent.
func TestOnlyANameShapedTheWayCloudflareTakesIsSent(t *testing.T) {
	for _, one := range []struct {
		what, name string
		usable     bool
	}{
		{"an ordinary name", "hound-haven", true},
		{"one character", "h", true},
		{"digits alone", "2026", true},
		{"the longest label", strings.Repeat("a", 63), true},
		{"one character past it", strings.Repeat("a", 64), false},
		{"nothing typed", "", false},
		{"a leading hyphen", "-hound", false},
		{"a trailing hyphen", "hound-", false},
		{"capitals", "Hound", false},
		{"a dot", "hound.haven", false},
		{"a space", "hound haven", false},
	} {
		if got := NameUsable(one.name); got != one.usable {
			t.Errorf("%s: NameUsable(%q) = %v", one.what, one.name, got)
		}
	}
}

// what the account holds, and the registration that gives it one where it holds none.

// a cloudflare answering `answers` for the account's own workers.dev name, recording every call
// made at it.
func naming(t *testing.T, answers ...any) (*[]asked, cf.Send) {
	t.Helper()
	made := []asked{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		made = append(made, asked{method: r.Method, path: r.URL.Path, body: body})
		at := len(made) - 1
		if at >= len(answers) {
			at = len(answers) - 1
		}
		write(w, answers[at])
	}))
	t.Cleanup(api.Close)
	return &made, cf.JSONSend(api.URL, map[string]string{})
}

// one call a case asserts on: what was asked of cloudflare and what was sent with it.
type asked struct {
	method, path string
	body         map[string]any
}

func nameRead(t *testing.T, answer any) Named {
	t.Helper()
	_, send := naming(t, answer)
	return AccountName(context.Background(), func(ctx context.Context, path string) cf.Answer {
		return send(ctx, http.MethodGet, path, nil)
	}, account)
}

func TestAnAccountsOwnWorkersDevNameIsReadBackWhereItHoldsOne(t *testing.T) {
	got := nameRead(t, envelope(map[string]any{"subdomain": "hound-haven"}))
	if got.Kind != NameHeld || got.Name != "hound-haven" {
		t.Fatalf("read %+v", got)
	}
}

// 10007 on the account's own subdomain is an account that has never registered one, which is the
// state a fork's first run meets and never a failure.
func TestAnAccountHoldingNoNameIsSaidSoAndNotReadAsAFailure(t *testing.T) {
	if got := nameRead(t, failed(10007, "not found")); got.Kind != NameNone {
		t.Fatalf("read %+v", got)
	}
}

// a read that found nothing out is not an account with no name: registering over one of those would
// move every deployment in the account.
func TestAReadThatDidNotLandIsNeverAnAccountWithNoName(t *testing.T) {
	for _, one := range []struct {
		what   string
		answer any
		kind   NameKind
	}{
		{"a sign-in cloudflare turned down", failed(10000, "Authentication error"), NameRefused},
		{"a cloudflare that answered nothing readable", coded{500, failed(1000, "server error")}, NameUnreachable},
		{"an answer in a shape nothing was written against", envelope(map[string]any{"subdomain": nil}), NameUnreadable},
	} {
		if got := nameRead(t, one.answer); got.Kind != one.kind {
			t.Errorf("%s: read %+v, want %s", one.what, got, one.kind)
		}
	}
}

func TestRegisteringANameSendsItToTheAccountsOwnWorkersDevSetting(t *testing.T) {
	made, send := naming(t, envelope(map[string]any{"subdomain": "hound-haven"}))

	got := RegisterName(context.Background(), send, account, "hound-haven")

	if got.Kind != NameRegistered || got.Name != "hound-haven" {
		t.Fatalf("registered %+v", got)
	}
	if len(*made) != 1 {
		t.Fatalf("%d calls were made", len(*made))
	}
	if one := (*made)[0]; one.method != http.MethodPut ||
		one.path != "/accounts/"+account+"/workers/subdomain" ||
		one.body["subdomain"] != "hound-haven" {
		t.Errorf("cloudflare was asked %+v", one)
	}
}

// a name one account anywhere in cloudflare already holds, which is the refusal the operator is
// asked about rather than one this console can repair.
func TestANameCloudflareWillNotTakeIsItsOwnStateAndCarriesWhatCloudflareSaid(t *testing.T) {
	got := RegisterName(context.Background(), sending(t,
		coded{409, failed(10031, "workers.api.error.subdomain_unavailable")}), account, "hound-haven")
	if got.Kind != NameTaken {
		t.Fatalf("registered %+v", got)
	}
	if !strings.Contains(got.Detail, "subdomain_unavailable") {
		t.Errorf("detail = %q, want what cloudflare said about it", got.Detail)
	}
}

func TestARegistrationThatDidNotLandKeepsTheStateCloudflareAnsweredIn(t *testing.T) {
	for _, one := range []struct {
		what   string
		answer any
		kind   NameKind
	}{
		{"a sign-in cloudflare turned down", failed(10000, "Authentication error"), NameRefused},
		{"cloudflare answering and registering nothing", coded{400, failed(1000, "bad request")}, NameFailed},
		// nothing is read off a success: a 2xx in a shape nothing was written against is a name that
		// was registered, and reporting it as a failure would stop a run over a name that is there.
		{"a success in a shape nothing was written against", envelope("hound-haven"), NameRegistered},
	} {
		if got := RegisterName(context.Background(), sending(t, one.answer), account, "hound-haven"); got.Kind != one.kind {
			t.Errorf("%s: registered %+v, want %s", one.what, got, one.kind)
		}
	}
}

// a cloudflare answering one thing, for the cases that assert on the reading alone.
func sending(t *testing.T, answer any) cf.Send {
	t.Helper()
	_, send := naming(t, answer)
	return send
}

// the worker's own workers.dev switch, turned on where a deployment answers nowhere.

// a cloudflare taking the switch as `took` and answering `answers` by path for every read after it.
func switching(t *testing.T, took any, answers map[string]any) (*[]asked, cf.Send) {
	t.Helper()
	made := []asked{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		made = append(made, asked{method: r.Method, path: r.URL.Path, body: body})
		if r.Method == http.MethodPost {
			write(w, took)
			return
		}
		held, named := answers[r.URL.Path]
		if !named {
			write(w, failed(10007, "not found"))
			return
		}
		write(w, held)
	}))
	t.Cleanup(api.Close)
	return &made, cf.JSONSend(api.URL, map[string]string{})
}

func TestTheWorkersOwnAddressIsTurnedOnAndWhereItAnswersIsReadAgain(t *testing.T) {
	made, send := switching(t, envelope(map[string]any{"enabled": true}), map[string]any{
		enablement: envelope(map[string]any{"enabled": true}),
		subdomain:  envelope(map[string]any{"subdomain": "hound-haven"}),
		domains:    envelope([]any{}),
	})

	got := Answering(context.Background(), send, account, worker)

	if got.Kind != Deployed || got.Origin() != "https://"+worker+".hound-haven.workers.dev" {
		t.Fatalf("read %+v", got)
	}
	if one := (*made)[0]; one.method != http.MethodPost || one.path != enablement {
		t.Fatalf("cloudflare was asked %+v first", one)
	}
	// previews stay off, for ../deploy/upload.go's reason: a preview url is a second address for
	// every version ever uploaded, and a deployment is the one place donors are sent.
	if one := (*made)[0]; one.body["enabled"] != true || one.body["previews_enabled"] != false {
		t.Errorf("the switch was sent %+v", one.body)
	}
}

func TestASwitchCloudflareWouldNotTakeIsTheAddressReadThatSaysSo(t *testing.T) {
	for _, one := range []struct {
		what   string
		took   any
		kind   AddressKind
		reads  int
		detail string
	}{
		{"a sign-in cloudflare turned down", failed(10000, "Authentication error"),
			AddressRefused, 1, "Authentication error"},
		{"a worker the account does not hold", failed(10007, "script_not_found"), NotDeployed, 1, ""},
		{"a cloudflare that answered nothing readable", coded{500, failed(1000, "server error")},
			AddressUnreachable, 1, "server error"},
	} {
		made, send := switching(t, one.took, map[string]any{})
		got := Answering(context.Background(), send, account, worker)
		if got.Kind != one.kind {
			t.Errorf("%s: read %+v, want %s", one.what, got, one.kind)
		}
		if one.detail != "" && !strings.Contains(got.Detail, one.detail) {
			t.Errorf("%s: detail = %q", one.what, got.Detail)
		}
		// a switch that was not taken is not an address to read: what came back is the answer.
		if len(*made) != one.reads {
			t.Errorf("%s: %d calls were made, want the switch alone", one.what, len(*made))
		}
	}
}
