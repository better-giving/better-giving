package deployment

import (
	"context"
	"net/http"
	"testing"

	"github.com/better-giving/console/internal/cf"
	"github.com/better-giving/console/internal/release"
)

// a deployment answering one thing to whatever is read, and the path it was asked, recorded.
func asking(answer cf.Answer) (cf.Get, *pressed) {
	held := &pressed{}
	return func(_ context.Context, path string) cf.Answer {
		held.path = path
		return answer
	}, held
}

// one standing per account the deployment can reach, under the name the fold draws it by.
func TestWhatEachAccountHoldsForRepeatingGiftsIsTheDeploymentsWord(t *testing.T) {
	for _, standing := range []string{"ready", "absent", "archived"} {
		get, asked := asking(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"processors": []any{
				map[string]any{
					"processor": "paypal", "label": "PayPal",
					"reading": map[string]any{"state": standing},
				},
			}},
		})
		read := ReadRecurring(context.Background(), get)
		if read.Kind != RecurringWasRead || len(read.Report.Processors) != 1 {
			t.Fatalf("read %+v", read)
		}
		held := read.Report.Processors[0]
		if held.Processor != "paypal" || held.Label != "PayPal" || held.Reading.State != standing {
			t.Fatalf("processor %+v", held)
		}
		if asked.path != RecurringPath {
			t.Fatalf("asked %q", asked.path)
		}
	}
}

// a fresh fork holds no processor credential at all, and a report saying so is an answer rather
// than a read that did not land: drawn as unread, the fold would say the deployment could not be
// asked over a deployment that answered plainly.
func TestADeploymentHoldingNoKeyAnswersWithNoStandingAtAll(t *testing.T) {
	get, _ := asking(cf.Answer{
		Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{"processors": []any{}},
	})
	read := ReadRecurring(context.Background(), get)
	if read.Kind != RecurringWasRead || len(read.Report.Processors) != 0 {
		t.Fatalf("read %+v", read)
	}
}

// the sentence is the whole of what an operator acts on, and a state saying only "could not read"
// is one this console has nothing to say under.
func TestAReadingTheDeploymentCouldNotMakeKeepsItsSentence(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"processors": []any{map[string]any{
			"processor": "stripe", "label": "Stripe",
			"reading": map[string]any{"state": "unreadable", "detail": "Set STRIPE_SECRET_KEY."},
		}},
	}})
	read := ReadRecurring(context.Background(), get)
	if read.Kind != RecurringWasRead {
		t.Fatalf("read %+v", read)
	}
	reading := read.Report.Processors[0].Reading
	if reading.State != "unreadable" || reading.Detail != "Set STRIPE_SECRET_KEY." {
		t.Fatalf("reading %+v", reading)
	}
}

// a deployment holding both processors reads as two standings that can disagree, each keeping its
// own account's answer: one processor nobody could reach must never be reported as an answer about
// another, and the lines stand in the deployment's own order rather than one this console picks.
func TestTwoAccountsEachKeepTheirOwnStanding(t *testing.T) {
	refused := "Stripe rejected the key."
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"processors": []any{
			map[string]any{
				"processor": "stripe", "label": "Stripe",
				"reading": map[string]any{"state": "unreadable", "detail": refused},
			},
			map[string]any{
				"processor": "paypal", "label": "PayPal",
				"reading": map[string]any{"state": "ready"},
			},
		},
	}})
	read := ReadRecurring(context.Background(), get)
	if read.Kind != RecurringWasRead || len(read.Report.Processors) != 2 {
		t.Fatalf("read %+v", read)
	}
	held := read.Report.Processors
	if held[0].Processor != "stripe" || held[0].Reading.State != "unreadable" ||
		held[0].Reading.Detail != refused {
		t.Fatalf("the first account %+v", held[0])
	}
	if held[1].Processor != "paypal" || held[1].Label != "PayPal" ||
		held[1].Reading.State != "ready" || held[1].Reading.Detail != "" {
		t.Fatalf("the second account %+v", held[1])
	}
}

// one entry this console cannot draw drops the whole report rather than the row it arrived on: the
// block is keyed off the processor, so an account quietly left out is one reported as an account
// this deployment holds no key for.
func TestOneUndrawableAccountDropsTheWholeReportRatherThanItsOwnRow(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"processors": []any{
			map[string]any{
				"processor": "stripe", "label": "Stripe",
				"reading": map[string]any{"state": "ready"},
			},
			map[string]any{
				"processor": "paypal", "label": "PayPal",
				"reading": map[string]any{"state": "pending"},
			},
		},
	}})
	if read := ReadRecurring(context.Background(), get); read.Kind != RecurringUnread {
		t.Fatalf("read %+v", read)
	}
}

func TestAStandingThisConsoleHasNoStateForIsNotReadAsOne(t *testing.T) {
	entry := func(reading any) map[string]any {
		return map[string]any{"processor": "stripe", "label": "Stripe", "reading": reading}
	}
	for what, body := range map[string]any{
		"no list of processors at all": map[string]any{"state": "ready"},
		"a standing nothing is drawn for": map[string]any{"processors": []any{
			entry(map[string]any{"state": "pending"}),
		}},
		"an unreadable arm with no sentence": map[string]any{"processors": []any{
			entry(map[string]any{"state": "unreadable"}),
		}},
		"a processor this console draws no fold for": map[string]any{"processors": []any{
			map[string]any{
				"processor": "elsewhere", "label": "Elsewhere",
				"reading": map[string]any{"state": "ready"},
			},
		}},
		"a processor named twice": map[string]any{"processors": []any{
			entry(map[string]any{"state": "ready"}), entry(map[string]any{"state": "absent"}),
		}},
		"a processor with no name to draw it by": map[string]any{"processors": []any{
			map[string]any{"processor": "stripe", "reading": map[string]any{"state": "ready"}},
		}},
	} {
		get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		if read := ReadRecurring(context.Background(), get); read.Kind != RecurringUnread {
			t.Errorf("a reading carrying %s was read as one", what)
		}
	}
}

func TestARecurringReadCarriesTheDeploymentsOwnRefusalWhole(t *testing.T) {
	get, _ := asking(cf.Answer{Kind: cf.Answered, Status: http.StatusUnauthorized, Body: map[string]any{
		"error": "session_mismatch", "message": "Another console.", "fix": "Connect again.",
	}})
	read := ReadRecurring(context.Background(), get)
	if read.Kind != RecurringUnread || read.Read.Kind != NoReportRefused {
		t.Fatalf("read %+v", read)
	}
}

func TestARecurringReadWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	read := ReadRecurring(context.Background(), nil)
	if read.Kind != RecurringUnread || read.Read.Kind != NoSession {
		t.Fatalf("read %+v", read)
	}
}

// the two successes are the same finished state said differently, and both are worth saying: an
// operator who pressed a button is owed the difference between having done something and nothing.
func TestAPressTellsTheTwoSuccessesApart(t *testing.T) {
	for _, outcome := range []string{"set_up", "already_set_up"} {
		post, press := posting(cf.Answer{
			Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
				"outcome": outcome,
				"processors": []any{map[string]any{
					"processor": "stripe", "label": "Stripe", "outcome": outcome,
				}},
			},
		})
		setup := SetUpRecurring(context.Background(), post, "")
		if setup.Kind != RecurringSetupReported || setup.Report.Outcome != outcome {
			t.Fatalf("setup %+v", setup)
		}
		if len(setup.Report.Processors) != 1 || setup.Report.Processors[0].Outcome != outcome {
			t.Fatalf("report %+v", setup.Report)
		}
		if press.path != RecurringPath {
			t.Fatalf("pressed %q", press.path)
		}
		// the operator's own press names no account, and an empty body is how the deployment is told
		// so: it is about every account that deployment holds credentials for.
		if body, _ := press.body.(map[string]any); len(body) != 0 {
			t.Fatalf("posted %v", press.body)
		}
	}
}

// a press made seconds after a run stored one processor's credentials names that account: which
// accounts the deployment counts as configured is read off the values it is serving, and one stored
// moments ago is not among them — so a press naming none would act on every account but the one it
// was made for.
func TestAPressAboutOneAccountNamesItInTheBody(t *testing.T) {
	post, press := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: map[string]any{
		"outcome": "set_up",
		"processors": []any{map[string]any{
			"processor": "stripe", "label": "Stripe", "outcome": "set_up",
		}},
	}})
	setup := SetUpRecurring(context.Background(), post, release.StripeProcessor)
	if setup.Kind != RecurringSetupReported {
		t.Fatalf("setup %+v", setup)
	}
	body, _ := press.body.(map[string]any)
	if len(body) != 1 || body["processor"] != release.StripeProcessor {
		t.Fatalf("posted %v", press.body)
	}
}

// one press naming nothing acts on every account the deployment holds keys for, and each answers
// for itself: an account that landed says nothing about the one beside it, and the word over the
// whole is the worst of them.
func TestAPressKeepsEveryAccountsOwnAnswer(t *testing.T) {
	refused := "PayPal would not create the product."
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadGateway, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{
			map[string]any{"processor": "stripe", "label": "Stripe", "outcome": "set_up"},
			map[string]any{
				"processor": "paypal", "label": "PayPal", "outcome": "failed",
				"reason": "failed", "detail": refused,
			},
		},
	}})
	setup := SetUpRecurring(context.Background(), post, "")
	if setup.Kind != RecurringSetupReported || setup.Report.Outcome != "failed" {
		t.Fatalf("setup %+v", setup)
	}
	held := setup.Report.Processors
	if len(held) != 2 || held[0].Outcome != "set_up" || held[0].Detail != nil {
		t.Fatalf("report %+v", setup.Report)
	}
	// nothing that worked carries either half of a failure.
	if held[0].Reason != nil {
		t.Fatalf("report %+v", setup.Report)
	}
	if held[1].Processor != "paypal" || held[1].Detail == nil || *held[1].Detail != refused {
		t.Fatalf("report %+v", setup.Report)
	}
	if held[1].Reason == nil || *held[1].Reason != "failed" {
		t.Fatalf("report %+v", setup.Report)
	}
}

// a refusal answers with a report saying what is in the way, and a reader keying on the status
// would throw that sentence away.
func TestAPressIsReadOffItsAnswerRatherThanItsStatus(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusBadGateway, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{map[string]any{
			"processor": "stripe", "label": "Stripe", "outcome": "failed",
			"reason": "failed", "detail": "Stripe refused the key.",
		}},
	}})
	setup := SetUpRecurring(context.Background(), post, release.StripeProcessor)
	if setup.Kind != RecurringSetupReported || setup.Report.Outcome != "failed" {
		t.Fatalf("setup %+v", setup)
	}
	if setup.Report.Processors[0].Detail == nil {
		t.Fatalf("report %+v", setup.Report)
	}
}

// the wait is a fact the deployment states and never a sentence read for one: the account is
// refused for a key stored seconds earlier that the values it is serving do not hold yet, and the
// next press finishes it.
func TestAPressRefusedForAKeyTheDeploymentHasNotPickedUpIsAWait(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{map[string]any{
			"processor": "stripe", "label": "Stripe", "outcome": "failed",
			"reason": "no_key", "detail": "This deployment cannot take a payment through Stripe.",
		}},
	}})
	if setup := SetUpRecurring(context.Background(), post, release.StripeProcessor); !setup.AwaitsKey() {
		t.Fatalf("setup %+v", setup)
	}
}

// the same account refused by the processor itself is not a wait: pressing again answers the same
// way, and the sentence is what says what to do instead.
func TestTheNamedAccountTheProcessorRefusedIsNotAWait(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{map[string]any{
			"processor": "stripe", "label": "Stripe", "outcome": "failed",
			"reason": "failed", "detail": "Stripe holds an archived one.",
		}},
	}})
	if setup := SetUpRecurring(context.Background(), post, release.StripeProcessor); setup.AwaitsKey() {
		t.Fatalf("setup %+v, want the processor's own refusal reported as itself", setup)
	}
}

// the wait is about the account the press named and no other: an operator who has never filled
// PayPal's boxes is short of a value rather than waiting on one, and a console saying to press again
// would be telling them to wait for something nothing is going to deliver.
func TestAnotherAccountShortOfItsOwnCredentialsIsNotAWait(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{
			map[string]any{"processor": "stripe", "label": "Stripe", "outcome": "set_up"},
			map[string]any{
				"processor": "paypal", "label": "PayPal", "outcome": "failed",
				"reason": "no_key", "detail": "This deployment cannot take a payment through PayPal.",
			},
		},
	}})
	if setup := SetUpRecurring(context.Background(), post, release.StripeProcessor); setup.AwaitsKey() {
		t.Fatalf("setup %+v, want PayPal's own shortfall reported as itself", setup)
	}
}

// and the account that is waiting is read as waiting whatever landed beside it, because the whole
// press is failed the moment one account is short and the word over it says nothing about which.
func TestTheNamedAccountAwaitingTheStoredKeyIsFoundAmongTheOthers(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{
			map[string]any{"processor": "paypal", "label": "PayPal", "outcome": "already_set_up"},
			map[string]any{
				"processor": "stripe", "label": "Stripe", "outcome": "failed",
				"reason": "no_key", "detail": "This deployment cannot take a payment through Stripe.",
			},
		},
	}})
	if setup := SetUpRecurring(context.Background(), post, release.StripeProcessor); !setup.AwaitsKey() {
		t.Fatalf("setup %+v", setup)
	}
}

// a press naming no account singles none out as waiting: it is the operator's own, made on a
// deployment holding whatever it holds, and nothing about it has just written a key for any of them.
func TestAPressNamingNoAccountLeavesNoneOfThemWaiting(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusInternalServerError, Body: map[string]any{
		"outcome": "failed",
		"processors": []any{map[string]any{
			"processor": "stripe", "label": "Stripe", "outcome": "failed",
			"reason": "no_key", "detail": "This deployment cannot take a payment through Stripe.",
		}},
	}})
	if setup := SetUpRecurring(context.Background(), post, ""); setup.AwaitsKey() {
		t.Fatalf("setup %+v, want an account nobody named left out of the wait", setup)
	}
}

// a press the deployment had no account to act on lands on the same wait rather than on a state of
// its own: nothing failed, and a press naming an account cannot provoke it at all.
func TestAPressTheDeploymentHadNothingToActOnLandsOnTheSameWait(t *testing.T) {
	post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusConflict, Body: map[string]any{
		"error": "nothing_to_set_up",
		"message": "This deployment holds no payment processor credentials, so there is no account " +
			"to set repeating gifts up on.",
		"fix": "Set `STRIPE_SECRET_KEY`.",
	}})
	setup := SetUpRecurring(context.Background(), post, "")
	if setup.Kind != RecurringSetupUnanswered || !setup.AwaitsKey() {
		t.Fatalf("setup %+v", setup)
	}
	// and the deployment's own sentence is still the whole of what a screen drawing that press has.
	if setup.Read == nil || setup.Read.Detail == "" {
		t.Fatalf("read %+v", setup.Read)
	}
}

func TestAPressAnsweredWithAnOutcomeNothingIsDrawnForIsUnanswered(t *testing.T) {
	for what, body := range map[string]any{
		"an outcome nothing is drawn for": map[string]any{
			"outcome": "queued", "processors": []any{},
		},
		"no account at all":          map[string]any{"outcome": "set_up", "processors": []any{}},
		"no list of accounts at all": map[string]any{"outcome": "set_up"},
		"an account with an outcome nothing is drawn for": map[string]any{
			"outcome": "set_up",
			"processors": []any{map[string]any{
				"processor": "stripe", "label": "Stripe", "outcome": "queued",
			}},
		},
		// the two members are wait and press again or stop and read the sentence, and a press that
		// did not land with neither of them on it is one this console cannot say which it is in.
		"an account that failed with no reason on it": map[string]any{
			"outcome": "failed",
			"processors": []any{map[string]any{
				"processor": "stripe", "label": "Stripe", "outcome": "failed",
				"detail": "Stripe refused the key.",
			}},
		},
		"an account that failed for a reason nothing is drawn for": map[string]any{
			"outcome": "failed",
			"processors": []any{map[string]any{
				"processor": "stripe", "label": "Stripe", "outcome": "failed",
				"reason": "later", "detail": "Stripe refused the key.",
			}},
		},
	} {
		post, _ := posting(cf.Answer{Kind: cf.Answered, Status: http.StatusOK, Body: body})
		setup := SetUpRecurring(context.Background(), post, release.StripeProcessor)
		if setup.Kind != RecurringSetupUnanswered || setup.Read.Kind != NoReportUnreadable {
			t.Errorf("a press answering %s was read as reported", what)
		}
	}
}

func TestARecurringPressWithNoSessionMakesNoRequestAtAll(t *testing.T) {
	setup := SetUpRecurring(context.Background(), nil, release.StripeProcessor)
	if setup.Kind != RecurringSetupUnanswered || setup.Read.Kind != NoSession {
		t.Fatalf("setup %+v", setup)
	}
}
