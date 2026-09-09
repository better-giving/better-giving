package widget

import (
	"context"
	"strings"
	"testing"
)

// this deployment's turnstile widget: the hosts it is made against, the widget found or made, and
// the hostnames brought level with a list the deployment stored.

func TestTheHostsAreTheOnesInsideTheSitesAndEachOfThemOnce(t *testing.T) {
	// a widget's domains are bare hosts and the deployment's list holds whole origins, so the port
	// and the scheme come off; two origins may share a host, and a widget carrying one twice is a
	// list cloudflare and this repository would describe differently.
	held := Hosts([]string{
		"https://example.org", "https://example.org:8443", "  ", "https://give.example.org",
	})
	if strings.Join(held, ",") != "example.org,give.example.org" {
		t.Errorf("hosts = %v", held)
	}
}

func TestARowWithNoHostInItIsDroppedRatherThanPassedThrough(t *testing.T) {
	// it is called on the boxes as they were typed, and a row an operator added and never filled in
	// is a value with no host in it.
	if held := Hosts([]string{"", "not a url", "mailto:someone"}); len(held) != 0 {
		t.Errorf("hosts = %v, want none", held)
	}
}

func TestAWidgetIsCreatedAgainstTheHostsWhereTheAccountHoldsNone(t *testing.T) {
	held, calls := serve(t, map[string]any{
		"GET " + widgets():  listed(),
		"POST " + widgets(): envelope(whole("0x4", "0x0secret", "example.org")),
	})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Kind != Supplied || supply.Made != Created {
		t.Fatalf("supply = %+v", supply)
	}
	if supply.Sitekey != "0x4" || supply.Secret != "0x0secret" {
		t.Errorf("supply = %+v, want the pair cloudflare minted", supply)
	}
	if supply.Levelled != nil {
		t.Error("a widget made against these hosts was levelled, which is a request saying nothing")
	}
	body := held.wrote(0)
	if body["name"] != name || body["mode"] != "managed" {
		t.Errorf("create body = %v", body)
	}
}

func TestTheAccountsOwnListStandsInFrontOfEveryCreate(t *testing.T) {
	// a second create under one name mints a second widget with its own pair and nothing dedupes on
	// the name, so a widget is adopted by name wherever one is already there.
	held, calls := serve(t, map[string]any{
		"GET " + widgets():  listed(row("0x4", "example.org")),
		"GET " + at("0x4"):  envelope(whole("0x4", "0x0secret", "example.org")),
		"POST " + widgets(): envelope(whole("0x9", "0x9secret", "example.org")),
		"PUT " + at("0x4"):  envelope(whole("0x4", "0x0secret", "example.org")),
	})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Made != Adopted || supply.Sitekey != "0x4" {
		t.Errorf("supply = %+v, want the widget already on the account", supply)
	}
	if held.saw("POST " + widgets()) {
		t.Errorf("a second widget was created; the press called %v", held.made())
	}
}

func TestAnAdoptedWidgetIsLevelledAndACreatedOneIsNot(t *testing.T) {
	held, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(row("0x4", "old.example.org")),
		"GET " + at("0x4"): envelope(whole("0x4", "0x0secret", "old.example.org")),
		"PUT " + at("0x4"): envelope(whole("0x4", "0x0secret", "example.org")),
	})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Levelled == nil || supply.Levelled.Kind != Made {
		t.Fatalf("levelled = %+v", supply.Levelled)
	}
	if strings.Join(supply.Domains, ",") != "example.org" {
		t.Errorf("domains = %v, want the hosts the update wrote", supply.Domains)
	}
	// the update replaces the widget whole, so what goes up is what the get answered with and the
	// new hostnames over it: a body carrying only `domains` blanks the name and the mode.
	body := held.wrote(0)
	if body["name"] != name || body["mode"] != "managed" {
		t.Errorf("update body = %v, want the widget as it was read", body)
	}
}

func TestTwoWidgetsOfOneNameAreRefusedRatherThanChosenBetween(t *testing.T) {
	// the pair the deployment holds belongs to exactly one of them and nothing here can tell which:
	// the list redacts the secret, so the two are indistinguishable from out here.
	held, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(row("0x4", "example.org"), row("0x9", "example.org")),
	})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Kind != Ambiguous || strings.Join(supply.Sitekeys, ",") != "0x4,0x9" {
		t.Errorf("supply = %+v", supply)
	}
	if len(held.made()) != 1 {
		t.Errorf("the press went on past the list: %v", held.made())
	}
}

func TestNoHostIsNoWidgetAndCloudflareIsAskedNothing(t *testing.T) {
	// a widget covering no host challenges nobody, so there is nothing to make it against.
	held, calls := serve(t, map[string]any{"GET " + widgets(): listed()})

	if supply := Provide(context.Background(), calls, name, nil); supply.Kind != NoHosts {
		t.Errorf("supply = %+v", supply)
	}
	if len(held.made()) != 0 {
		t.Errorf("cloudflare was asked %v", held.made())
	}
}

func TestAListThatWasNotReadIsItsOwnAnswerAndNothingIsMade(t *testing.T) {
	held, calls := serve(t, map[string]any{"GET " + widgets(): 403})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Kind != Unlisted || supply.Read == nil || supply.Read.Kind != ReadRefused {
		t.Fatalf("supply = %+v", supply)
	}
	if held.saw("POST " + widgets()) {
		t.Error("a widget was created on an account whose list nobody could read")
	}
}

func TestACreateCloudflareTurnedDownCarriesItsOwnWordsAndNoPair(t *testing.T) {
	_, calls := serve(t, map[string]any{
		"GET " + widgets():  listed(),
		"POST " + widgets(): 403,
	})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Kind != Unmade || supply.Failure == nil || supply.Failure.Kind != CallRefused {
		t.Fatalf("supply = %+v", supply)
	}
	if supply.Secret != "" {
		t.Error("a create that failed carries a secret")
	}
	if !strings.Contains(supply.Failure.Detail, "Authentication error") {
		t.Errorf("detail = %q, want cloudflare's own words", supply.Failure.Detail)
	}
}

func TestASuccessInAShapeNothingWasWrittenAgainstQuotesNoneOfIt(t *testing.T) {
	// every success here is the widget whole, so each character of that body is a credential until
	// proven otherwise: the sentence an operator reads is the screen's own.
	_, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(),
		"POST " + widgets(): envelope(map[string]any{
			"sitekey": "0x4", "secret_key": "0x0secret",
		}),
	})

	supply := Provide(context.Background(), calls, name, []string{"example.org"})
	if supply.Kind != Unmade || supply.Failure.Kind != CallUnreadable {
		t.Fatalf("supply = %+v", supply)
	}
	if supply.Failure.Detail != "" {
		t.Errorf("detail = %q, want nothing off a body this console could not read", supply.Failure.Detail)
	}
}

func TestAListAlreadyCarryingTheseHostsAsksCloudflareNothing(t *testing.T) {
	// the hosts are compared as sets: the order on a widget carries no meaning and cloudflare hands
	// them back in its own, so a press that reordered them would spend two requests saying nothing.
	held, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(row("0x4", "give.example.org", "example.org")),
	})

	level := Bring(context.Background(), calls, name, []string{"example.org", "give.example.org"})
	if level.Kind != Already {
		t.Fatalf("level = %+v", level)
	}
	if held.saw("PUT " + at("0x4")) {
		t.Error("a widget already carrying these hosts was written to")
	}
}

func TestTheWholeListGoesUpRatherThanTheHostThatChanged(t *testing.T) {
	held, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(row("0x4", "example.org")),
		"GET " + at("0x4"): envelope(whole("0x4", "0x0secret", "example.org")),
		"PUT " + at("0x4"): envelope(whole("0x4", "0x0secret", "example.org", "give.example.org")),
	})

	level := Bring(context.Background(), calls, name, []string{"example.org", "give.example.org"})
	if level.Kind != Made {
		t.Fatalf("level = %+v", level)
	}
	if strings.Join(level.Domains, ",") != "example.org,give.example.org" {
		t.Errorf("domains = %v", level.Domains)
	}
	body := held.wrote(0)
	hosts, _ := body["domains"].([]any)
	if len(hosts) != 2 {
		t.Errorf("update body = %v, want both hosts and not the one that changed", body)
	}
}

func TestAnEmptyListAsksForNothingAtAll(t *testing.T) {
	// a widget covering no host challenges nobody, so an operator who has emptied the site list has
	// a widget to delete rather than one to level.
	held, calls := serve(t, map[string]any{"GET " + widgets(): listed(row("0x4", "example.org"))})

	if level := Bring(context.Background(), calls, name, nil); level.Kind != NoHostsLeft {
		t.Errorf("level = %+v", level)
	}
	if len(held.made()) != 0 {
		t.Errorf("cloudflare was asked %v", held.made())
	}
}

func TestAnAccountHoldingNoWidgetOfThisNameIsItsOwnAnswer(t *testing.T) {
	_, calls := serve(t, map[string]any{"GET " + widgets(): listed(row("0x4", "example.org"))})

	level := Bring(context.Background(), calls, "another-name", []string{"example.org"})
	if level.Kind != Absent {
		t.Errorf("level = %+v", level)
	}
}

func TestALevellingThatLandedQuotesNothingOffTheWidgetItReadBack(t *testing.T) {
	// the answer is the widget as it now stands, the secret included, so the domains are lifted out
	// and the rest is dropped.
	_, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(row("0x4", "old.example.org")),
		"GET " + at("0x4"): envelope(whole("0x4", "0x0secret", "old.example.org")),
		"PUT " + at("0x4"): envelope(whole("0x4", "0x0secret", "example.org")),
	})

	level := Bring(context.Background(), calls, name, []string{"example.org"})
	if leaks(level.Detail, "0x0secret") {
		t.Errorf("detail = %q", level.Detail)
	}
}

func TestAReadOfTheWidgetThatFailedIsNotWrittenBackOver(t *testing.T) {
	// the PUT replaces the widget whole, so a body missing the name or the mode is one there is no
	// writing back without blanking the field it left out — nothing is written at all.
	held, calls := serve(t, map[string]any{
		"GET " + widgets(): listed(row("0x4", "old.example.org")),
		"GET " + at("0x4"): envelope(map[string]any{"sitekey": "0x4", "domains": []any{}}),
	})

	level := Bring(context.Background(), calls, name, []string{"example.org"})
	if level.Kind != Unreadable {
		t.Fatalf("level = %+v", level)
	}
	if held.saw("PUT " + at("0x4")) {
		t.Error("a widget nobody could read whole was written back over")
	}
}
