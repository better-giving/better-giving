// the one json http client this binary has, bound to a host and its headers once.
//
// **it is one client rather than one per host, and most of its callers are not cloudflare.**
// ./cloudflare.go reads the account's API through it, and the reads and writes of a deployment's
// own console surface go through it too, on a credential of a different kind entirely. what makes
// it one function rather than two is everything around the call: the timeout that keeps a screen
// from saying `Checking` for as long as the tab is open, a body that may not be json, and a failure
// that is a value rather than an error to unwind on. a second client would be a second place any of
// those is decided.
//
// **the credential is closed over here and passed no further, whichever kind it is:** a caller is
// handed a function and never a token, so nothing that decides what a screen says has one to leak.
// every request carries it in a header and every url carries none, which is what makes a failure's
// own sentence safe to draw.
//
// **a multipart write is the same call with another body on it.** two of cloudflare's endpoints
// take no json at all — the script upload, whose modules are one part each, and the assets upload,
// whose parts are the files — and MultipartSend is those two rather than a client of their own: the
// same credential in the same header, the same failure as a value, and one more timeout nobody has
// to decide twice.
//
// **a write answers in the same three ways a read does** — a status with a body, a body that is not
// json, nothing at all — so a write is this same call with a method and a body on it rather than a
// client of its own. a second place deciding any of those is a second timeout and a second reading
// of a failure.
//
// every failure is a value: nothing here returns an error, and an error handed up to a handler
// would be a 500 in place of the state that explains it.
package cf

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

// how long one call may take before it counts as unreachable.
//
// a call with no bound would hold the handler open for as long as the browser waits on it, which
// leaves the screen saying `Checking` for as long as the tab is open. the caller's own context
// bounds it further wherever it has a shorter deadline of its own.
const timeout = 10 * time.Second

// how long one upload may take before it counts as unreachable.
//
// far past the ten seconds a read is bounded by, because what travels here is the worker's own
// javascript and a bucket of the deployment's static files — megabytes over whatever connection the
// operator is on. the caller's own context bounds it further wherever it has a shorter deadline.
const uploadTimeout = 5 * time.Minute

// how long one schema change may take before it counts as unreachable.
//
// far past the ten seconds a read is bounded by, and for a reason of its own: a migration file goes
// up as one string of ddl and d1 answers only once it has run all of it, so this app's first
// migration is tens of kilobytes of statements against a remote database inside one request. a call
// cut at the read's bound leaves a database that has already committed what it got through, and
// nothing here makes a `CREATE TABLE` conditional — so the rerun dies on the first one it repeats.
const schemaTimeout = 5 * time.Minute

// AnswerKind is which of the two ways a call ended. A zero Answer is neither and never leaves this
// package.
type AnswerKind string

const (
	// Answered is a status and whatever body came with it, the body being unreadable included.
	Answered AnswerKind = "answered"
	// Unreachable is nothing found out either way: no route to the host, or it took too long.
	Unreachable AnswerKind = "unreachable"
)

// Answer is what a call answered, or the reason there was no answer.
type Answer struct {
	Kind   AnswerKind
	Status int
	// Body is the json the host sent, decoded, or nil where what came back was not json.
	Body any
	// Detail is why there was no answer, and is empty on one.
	Detail string
}

// Get is one authenticated read, by path.
type Get func(ctx context.Context, path string) Answer

// Post is one authenticated write, by path, carrying a json body.
//
// The same Answer a read hands back, because a write is refused, unreachable or unreadable in
// exactly the ways a read is and a screen has the same three things to say about it.
type Post func(ctx context.Context, path string, body any) Answer

// Send is one authenticated call, by method and path, carrying a json body where it has one.
//
// What Get and Post are both bound out of, and what a host with more than those two shapes to it is
// reached through: a caller states the method and is handed back the same Answer either of the two
// above hands back.
type Send func(ctx context.Context, method, path string, body any) Answer

// JSONSend is a json call to one host, bound to its headers once.
//
// A body is what decides whether the request declares one: a call made with a nil body sends no
// `Content-Type` and no bytes, which is what a read is.
//
// The bound headers win over that default, which is how a body of some other json dialect is sent:
// MergePatchHeaders in ./cloudflare.go binds `application/merge-patch+json` and is the only binding
// that names the header at all.
func JSONSend(base string, headers map[string]string) Send {
	return JSONSendWithin(base, headers, timeout)
}

// JSONSendWithin is that same call bound to a deadline the caller states rather than to the one a
// read is made with.
//
// **the bound belongs to the call and not to the client, because one of them is not a read.** the
// ten seconds a screen's read is held to is what a migration file is cut part way through, and what
// that leaves behind is a database that committed it and no row saying so.
func JSONSendWithin(base string, headers map[string]string, within time.Duration) Send {
	return func(ctx context.Context, method, path string, body any) Answer {
		var reader io.Reader
		if body != nil {
			written, err := json.Marshal(body)
			if err != nil {
				return Answer{Kind: Unreachable, Detail: err.Error()}
			}
			reader = bytes.NewReader(written)
		}

		bound, stop := context.WithTimeout(ctx, within)
		defer stop()

		request, err := http.NewRequestWithContext(bound, method, base+path, reader)
		if err != nil {
			return Answer{Kind: Unreachable, Detail: err.Error()}
		}
		if body != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		for name, value := range headers {
			request.Header.Set(name, value)
		}
		return answered(request)
	}
}

// FormPost is one call carrying a form-encoded body, by path.
type FormPost func(ctx context.Context, path string, form url.Values) Answer

// FormCall is one call carrying a form-encoded body where it has one, by method and path.
type FormCall func(ctx context.Context, method, path string, form url.Values) Answer

// FormSender is a form-encoded call to one host, bound to its headers once.
//
// **two hosts here take no json.** cloudflare's oauth token and revoke calls are
// `application/x-www-form-urlencoded` by RFC 6749, and the processor's own API is form-encoded on
// every write and reads a list as `name[0]`, `name[1]` — a comma-joined value is refused and a
// repeated bare name is read as the last one alone, which would subscribe an endpoint to one
// delivery and look like it worked. so a list is the caller's to spell, and url.Values carries it.
//
// A nil form is what decides whether the request declares a body at all, which is JSONSendWithin's
// arrangement for the same reason: a read that declared an empty form would be a GET with a content
// type on it.
func FormSender(base string, headers map[string]string) FormCall {
	return func(ctx context.Context, method, path string, form url.Values) Answer {
		bound, stop := context.WithTimeout(ctx, timeout)
		defer stop()

		var reader io.Reader
		if form != nil {
			reader = strings.NewReader(form.Encode())
		}
		request, err := http.NewRequestWithContext(bound, method, base+path, reader)
		if err != nil {
			return Answer{Kind: Unreachable, Detail: err.Error()}
		}
		if form != nil {
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		for name, value := range headers {
			request.Header.Set(name, value)
		}
		return answered(request)
	}
}

// FormSend is that same call bound to the one method the oauth endpoints take.
func FormSend(base string, headers map[string]string) FormPost {
	call := FormSender(base, headers)
	return func(ctx context.Context, path string, form url.Values) Answer {
		if form == nil {
			form = url.Values{}
		}
		return call(ctx, http.MethodPost, path, form)
	}
}

// JSONGet is a json read of one host, bound to its headers once.
func JSONGet(base string, headers map[string]string) Get {
	send := JSONSend(base, headers)
	return func(ctx context.Context, path string) Answer {
		return send(ctx, http.MethodGet, path, nil)
	}
}

// JSONPost is a json write to one host, bound to its headers once.
//
// What this posts to is a deployment's own console surface, where a mutation is a POST of json and
// answers with the report.
func JSONPost(base string, headers map[string]string) Post {
	send := JSONSend(base, headers)
	return func(ctx context.Context, path string, body any) Answer {
		return send(ctx, http.MethodPost, path, body)
	}
}

// one call, with the parse and the failure-as-a-value every binding shares.
func answered(request *http.Request) Answer {
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return Answer{Kind: Unreachable, Detail: err.Error()}
	}
	defer response.Body.Close()
	return Answer{Kind: Answered, Status: response.StatusCode, Body: parsed(response.Body)}
}

// what a body holds where it holds json, and nil where it holds anything else.
func parsed(body io.Reader) any {
	var value any
	if err := json.NewDecoder(body).Decode(&value); err != nil {
		return nil
	}
	return value
}

// Part is one part of a multipart body.
//
// A part with no Filename declares none, which is what a field carrying json rather than a file is;
// a part with no ContentType declares none either, rather than falling back to a type nobody chose.
type Part struct {
	Name        string
	Filename    string
	ContentType string
	Body        []byte
}

// Sending is how much of a multipart body has gone up, called as it goes.
//
// **it counts bytes handed to the connection and never bytes the host acknowledged.** what the
// reader below hands on is what the operating system took, so a call at the full length says the
// request was sent rather than that cloudflare has it — the answer is the only thing that says that.
//
// `of` is the whole body's length, known before the first byte moves because a multipart body is
// built in memory here.
//
// **it is called on the goroutine net/http writes the body on, and never on the caller's.** the
// caller is still blocked inside the call while this runs, so a watcher may touch nothing that
// caller is touching, and one that blocks holds the upload up.
type Sending func(sent, of int64)

// MultipartUpload is one authenticated multipart call, by method and path.
//
// `watching` is how the bytes are counted on their way up, and nil where nobody is counting them.
type MultipartUpload func(ctx context.Context, method, path string, parts []Part, watching Sending) Answer

// MultipartSend is a multipart call to one host, bound to its headers once.
//
// The two writes this console makes that carry no json: the script upload, whose metadata and
// modules are one part each, and the assets upload, whose parts are the files. The bound headers
// are the credential, and they are the caller's — the assets upload is made on a token the upload
// session hands back rather than on the account's own.
func MultipartSend(base string, headers map[string]string) MultipartUpload {
	return func(ctx context.Context, method, path string, parts []Part, watching Sending) Answer {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		for _, part := range parts {
			header := textproto.MIMEHeader{}
			disposition := `form-data; name="` + escaped(part.Name) + `"`
			if part.Filename != "" {
				disposition += `; filename="` + escaped(part.Filename) + `"`
			}
			header.Set("Content-Disposition", disposition)
			if part.ContentType != "" {
				header.Set("Content-Type", part.ContentType)
			}
			written, err := form.CreatePart(header)
			if err != nil {
				return Answer{Kind: Unreachable, Detail: err.Error()}
			}
			if _, err := written.Write(part.Body); err != nil {
				return Answer{Kind: Unreachable, Detail: err.Error()}
			}
		}
		if err := form.Close(); err != nil {
			return Answer{Kind: Unreachable, Detail: err.Error()}
		}

		bound, stop := context.WithTimeout(ctx, uploadTimeout)
		defer stop()

		length := int64(body.Len())
		source := io.Reader(&body)
		if watching != nil {
			source = &sending{from: &body, of: length, say: watching}
		}
		request, err := http.NewRequestWithContext(bound, method, base+path, source)
		if err != nil {
			return Answer{Kind: Unreachable, Detail: err.Error()}
		}
		// http.NewRequestWithContext works the length out for a *bytes.Buffer and for nothing else,
		// so the wrapped body above would go up chunked — which a workers script PUT may refuse for
		// a reason that says nothing about the script. stated here, so both bodies declare it.
		request.ContentLength = length
		request.Header.Set("Content-Type", form.FormDataContentType())
		for name, value := range headers {
			request.Header.Set(name, value)
		}
		return answered(request)
	}
}

// a reader that says how much of the body has gone, as it hands it on.
type sending struct {
	from io.Reader
	of   int64
	sent int64
	say  Sending
}

func (counter *sending) Read(into []byte) (int, error) {
	got, err := counter.from.Read(into)
	if got > 0 {
		counter.sent += int64(got)
		counter.say(counter.sent, counter.of)
	}
	return got, err
}

// the escaping a part's own name and filename take, which is what the standard library's own form
// writer applies to both.
var escaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"", "\r", "", "\n", "")

func escaped(value string) string { return escaper.Replace(value) }
