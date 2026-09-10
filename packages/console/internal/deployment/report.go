package deployment

import (
	"context"
	"net/http"
	"strconv"

	"github.com/better-giving/console/internal/cf"
)

// what the deployment says about itself, read over the session this console holds.
//
// **the deployment answers and this console renders.** the rows are the deployment's own and
// nothing here derives a second opinion about any of them — the console derives no capability, and
// there is nothing sent it could derive one from.
//
// **a refusal is carried whole.** the deployment writes a code a machine reads and two sentences a
// reader does, and the second of those is the only thing on a screen that says how to get out of
// the state the console is in. this shortens neither and writes neither of its own. it holds for
// every refusal and not only the 401: a body the endpoint could not read is refused in the same
// members, and `unreadable` carries the way out beside the sentence for that reason.
//
// **the shape check is shallow and deliberately so.** what is asserted is that this is an envelope
// from that surface rather than an unrelated json body — a page at a custom domain that is not this
// deployment, or a proxy answering for it. what the lines inside it say is the deployment's
// business and is rendered as it arrived.
//
// **how a call to that surface is bound is here too, because two packages bind it.**
// internal/server binds it for the browser's reading of the home screen and for the errands the
// console writes through, and internal/effects binds it to find out which release the deployment
// carries before `start` offers to carry another. a second spelling of it in either place is how
// one of them comes to send the session somewhere the other does not.

// ConsolePath is the path on a deployment that answers with what it knows about itself.
const ConsolePath = "/console"

// ReportKind is which of the six ways a read of that surface ended.
type ReportKind string

const (
	// Reported is the envelope, which is the only kind carrying any of it.
	Reported ReportKind = "report"
	// NoReportRefused is the deployment holding a different session, or none.
	NoReportRefused ReportKind = "refused"
	// NoSession is this console holding no session, so there is no request to make.
	NoSession ReportKind = "no-session"
	// NoSurface is something answering at that address that serves no console surface.
	NoSurface ReportKind = "no-surface"
	// NoReportUnreachable is nothing found out either way.
	NoReportUnreachable ReportKind = "unreachable"
	// NoReportUnreadable is an answer in a shape nothing here was written against.
	NoReportUnreadable ReportKind = "unreadable"
)

// NoReport is the way an answer was not a report, which is the whole of what a screen draws about
// one.
//
// Its own type rather than the read with its rows left empty: the rows are what a report carries,
// and a face that is about there being no report would otherwise put empty ones on the wire beside
// the sentence — which reads as a deployment holding nothing rather than as a deployment nobody
// asked.
//
// The three sentence members are pointers because a screen draws nothing where the deployment wrote
// nothing, and an empty string is a sentence of no words rather than the absence of one.
type NoReport struct {
	Kind ReportKind `json:"kind"`
	// Error, Message and Fix are the deployment's own words about a refusal. Every one of them may
	// be nil together: a 401 in a shape this was not written against is still a refusal.
	Error   *string `json:"error"`
	Message *string `json:"message"`
	Fix     *string `json:"fix"`
	// Detail is what an unreachable or unreadable answer said, in its own words where it wrote any.
	Detail string `json:"detail"`
}

// ReportRead is what the deployment answered, or which way it did not.
type ReportRead struct {
	NoReport

	// Sites is every site this deployment's forms may be used on, in the operator's own order.
	Sites []string `json:"sites"`
	// Org is the organisation's legal identity as the deployment holds it, or nil where nobody has
	// saved one. It is carried through rather than read: what a value may be is the deployment's,
	// and a console that restated one would be a second opinion about it.
	Org any `json:"org"`
	// Version is the release this deployment's worker was built from, without a leading `v`, or nil
	// where the envelope names none.
	//
	// Two deployments wear that absence and a console treats them alike: one older than this member,
	// and one built from a checkout rather than a tagged release. Neither can be weighed against a
	// release, so a reading that offers an update judges such a deployment by its migrations alone.
	Version *string `json:"version"`
}

// Calls is how a call to a deployment's own console surface is bound.
//
// The session travels in a header and never on the url, which is internal/cf's arrangement for
// every credential this binary holds: the reader that decides what a screen says is handed a
// function and never a token. One binding for reads and writes alike, because the seven errands
// write through the same door a reading reads through.
func Calls(origin, token string) cf.Send {
	return cf.JSONSend(origin, map[string]string{"Authorization": "Bearer " + token})
}

// Reads is the read half of such a binding, which is the whole of what a reading of the deployment
// needs.
//
// `calls` is handed in rather than taken as ./Calls, so a case can answer for a deployment that is
// not there (internal/server's Options.Surface).
func Reads(calls func(origin, token string) cf.Send) func(origin, token string) cf.Get {
	return func(origin, token string) cf.Get {
		send := calls(origin, token)
		return func(ctx context.Context, path string) cf.Answer {
			return send(ctx, http.MethodGet, path, nil)
		}
	}
}

// Report is one read of that surface, over a reader already bound to the session.
func Report(ctx context.Context, get cf.Get) ReportRead {
	return readReport(get(ctx, ConsolePath))
}

// one answer from the console surface, read.
func readReport(answer cf.Answer) ReportRead {
	if answer.Kind == cf.Unreachable {
		return ReportRead{NoReport: NoReport{Kind: NoReportUnreachable, Detail: answer.Detail}}
	}

	body, _ := answer.Body.(map[string]any)
	if answer.Status == http.StatusUnauthorized {
		return ReportRead{NoReport: NoReport{
			Kind:    NoReportRefused,
			Error:   text(body["error"]),
			Message: text(body["message"]),
			Fix:     text(body["fix"]),
		}}
	}
	// nothing is served there under that path, which is what a deployment older than the console
	// surface answers: it is up, this console reached it, and the routes it is asking for are not on
	// the version it is holding.
	if answer.Status == http.StatusNotFound {
		return ReportRead{NoReport: NoReport{Kind: NoSurface}}
	}
	if answer.Status < 200 || answer.Status > 299 {
		return unreadable(answer, body)
	}

	sites, listed := body["sites"].([]any)
	if !listed {
		return unreadable(answer, body)
	}
	session, held := body["session"].(map[string]any)
	if !held {
		return unreadable(answer, body)
	}
	if _, isText := session["expiresAt"].(string); !isText {
		return unreadable(answer, body)
	}

	rows := []string{}
	for _, site := range sites {
		if named, isText := site.(string); isText {
			rows = append(rows, named)
		}
	}
	return ReportRead{
		NoReport: NoReport{Kind: Reported},
		Sites:    rows,
		Org:      body["org"],
		Version:  text(body["version"]),
	}
}

// what the deployment said about a failure, in its own words where it wrote any.
//
// Both sentences, never the first alone: a refusal outside 401 carries a way out the same way a 401
// does, and dropping it here would drop it from every screen at once.
func unreadable(answer cf.Answer, body map[string]any) ReportRead {
	detail := "This deployment answered " + strconv.Itoa(answer.Status)
	if said := text(body["message"]); said != nil {
		detail = *said
	}
	return ReportRead{NoReport: NoReport{
		Kind:   NoReportUnreadable,
		Detail: detail,
		Fix:    text(body["fix"]),
	}}
}

func text(value any) *string {
	said, ok := value.(string)
	if !ok || said == "" {
		return nil
	}
	return &said
}

// readNoReport classifies one answer from that surface where what was expected was not the
// envelope.
//
// The acts on this surface — the test send, provisioning repeating gifts — answer with a report of
// the press rather than with the deployment's own report: nothing about the deployment moved, so
// there is no row for an envelope to carry. What stays the same is every way an answer can fail to
// be the thing asked for, and it stays the same by being this function.
//
// An envelope arriving where an act's report was expected is unreadable rather than a report,
// because the caller has no state for it — it is a deployment answering a question other than the
// one asked.
func readNoReport(answer cf.Answer) NoReport {
	read := readReport(answer)
	if read.Kind != Reported {
		return read.NoReport
	}
	body, _ := answer.Body.(map[string]any)
	return unreadable(answer, body).NoReport
}
