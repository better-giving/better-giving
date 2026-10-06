// Package nonprofits is the console's door to the IRS nonprofit API, which finds the organisation an
// operator is setting up for: by EIN, or by a search over names.
//
// **one fixed address, and nothing reads another.** every console is built with API, and no env
// var, flag or record may point a console elsewhere: what comes back fills the legal identity a
// receipt is printed under, so the source is the build's to name. a test builds a client on its own
// upstream with At. the deployment reads the same API for its page AI, and
// `packages/app/src/lib/server/nonprofits/filing.ts` holds its copy of the address and the shape:
// the two change together, and ../release/config_test.go holds them equal.
//
// **keyless.** no key is sent and none is configured, so the console spends the allowance the API
// keeps per calling address — one request a minute and five a day (https://nonprofits.better.giving).
// a refusal for the minute is the one the console waits out: once, for the `Retry-After` it names
// and at most longestWait, and then asked again. any other refusal, or a second one, is answered.
//
// **every failure is an answer, and `unavailable` is all of them.** no route, a timeout, a refusal
// for the day or for the service, the API saying its data is unavailable, a second refusal for the
// minute, any status but 200 or a 404 coded `not_found`, a body past answerBytes or in a shape
// decoded nowhere below — the fold leaves the boxes as typed and set-up goes on by hand, so none of
// these is an error to anyone.
//
// **what was found out is remembered for the run, and what was not is not.** the API is sized for
// set-up rather than for a box asking per keystroke, so one console run asks it once per EIN and
// once per query, callers in flight together included, and a caller that gives up does not take the
// request it started down with it (memory); an `unavailable` is forgotten, because the next try may
// land.
//
// **the upstream shape is decoded in one place per path** (upstreamOrganisation, upstreamMatches),
// and unknown members are ignored: the API grows facts this console does not read, and a member it
// adds is no reason to stop filling.
package nonprofits

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

// API is where the IRS nonprofit API answers.
const API = "https://nonprofits.better.giving"

// how long one request may take before the API counts as not answering: a box waits on it.
const within = 5 * time.Second

// the longest `Retry-After` waited out before a per-minute refusal is asked again.
const longestWait = time.Minute

// AskBound is how long one lookup or search may take: a request, the one wait a per-minute refusal
// is given, and the request after it. ../server's write timeout covers it.
const AskBound = within + longestWait + within

// the most of one answer read, past which it is no answer: a lookup is one organisation and a search
// at most a page of them.
const answerBytes = 256 << 10

// the most matches one search keeps, in the API's order.
const mostMatches = 10

// MissionMax is the longest mission the organisation's profile saves: `MAX_STATEMENT` in
// packages/operator/src/console/org-rules.ts, which ../release/config_test.go holds this to. it is
// counted the way that rule's `.max` counts a string, in UTF-16 code units.
const MissionMax = 2000

// LookupState is how one lookup by EIN went.
type LookupState string

const (
	Found       LookupState = "found"
	NotFound    LookupState = "not_found"
	Unavailable LookupState = "unavailable"
)

// SearchState is how one search went: a list, empty or not, or no answer.
type SearchState string

const (
	Listed            SearchState = "ok"
	SearchUnavailable SearchState = "unavailable"
)

// Organisation is one organisation's legal details as the Organisation details fold fills them,
// under the names it gives its boxes (packages/console-ui/src/lib/org-fields.ts) where it fills
// one. EIN is the nine digits with no dash; RevokedOn is the `YYYY-MM-DD` its tax-exempt status was
// revoked on, empty where it is not revoked or was reinstated since; Mission is what the latest
// filing states, trimmed and cut to MissionMax so the box it fills saves. every field is empty
// unless Found.
type Organisation struct {
	EIN          string `json:"ein"`
	Name         string `json:"name"`
	AddressLine1 string `json:"address_line1"`
	City         string `json:"city"`
	Region       string `json:"region"`
	PostalCode   string `json:"postal_code"`
	Deductible   bool   `json:"deductible"`
	RevokedOn    string `json:"revokedOn"`
	Website      string `json:"website"`
	Mission      string `json:"mission"`
}

// Lookup is one lookup by EIN.
type Lookup struct {
	State        LookupState  `json:"state"`
	Organisation Organisation `json:"organisation"`
}

// Match is one organisation a search listed, in the fields a pick is made by. State is the US
// state, as Organisation's Region is. RevokedOn is empty on every match of a name search, whose
// answer carries no revocation; the lookup a pick makes says it.
type Match struct {
	EIN        string `json:"ein"`
	Name       string `json:"name"`
	City       string `json:"city"`
	State      string `json:"state"`
	Deductible bool   `json:"deductible"`
	RevokedOn  string `json:"revokedOn"`
}

// Search is one search. Matches is never nil.
type Search struct {
	State   SearchState `json:"state"`
	Matches []Match     `json:"matches"`
}

// Client asks the API and remembers what it found out, for as long as it lives — which is one
// console run, because the server builds one. it is safe for concurrent handlers.
type Client struct {
	base      string
	http      *http.Client
	within    time.Duration
	askWithin time.Duration
	wait      func(context.Context, time.Duration) bool
	lookups   memory[Lookup]
	searches  memory[Search]
}

// New is a client on API.
func New() *Client { return At(API) }

// At is a client on another address, which is a test upstream everywhere but New.
func At(base string) *Client {
	return &Client{
		base:      strings.TrimSuffix(base, "/"),
		http:      &http.Client{},
		within:    within,
		askWithin: AskBound,
		wait:      pause,
		lookups:   memory[Lookup]{kept: map[string]*recalled[Lookup]{}},
		searches:  memory[Search]{kept: map[string]*recalled[Search]{}},
	}
}

// Built is whether this client has an address to ask: false is every answer `unavailable`, which
// a screen can know before anyone types.
func (c *Client) Built() bool { return c.base != "" }

// EIN is the nine digits an EIN is, read off what was typed: space around it and the one dash the
// IRS prints after the second digit are dropped, and anything else is no EIN.
func EIN(typed string) (string, bool) {
	ein := strings.TrimSpace(typed)
	if len(ein) == 10 && ein[2] == '-' {
		ein = ein[:2] + ein[3:]
	}
	if len(ein) != 9 || strings.ContainsFunc(ein, func(r rune) bool { return r < '0' || r > '9' }) {
		return "", false
	}
	return ein, true
}

// Query is a search as it is asked and remembered: trimmed, lowercased, every run of space one.
func Query(typed string) string {
	return strings.ToLower(strings.Join(strings.Fields(typed), " "))
}

// LookUp is the organisation an EIN names. what is not an EIN is asked nothing and answered
// `unavailable`; the route refuses it before it gets here.
func (c *Client) LookUp(ctx context.Context, typed string) Lookup {
	ein, ok := EIN(typed)
	if !ok || c.base == "" {
		return Lookup{State: Unavailable}
	}
	missed := Lookup{State: Unavailable}
	return c.lookups.recall(ctx, ein, missed, func(asking context.Context) (Lookup, bool) {
		looked := c.lookUp(asking, ein)
		return looked, looked.State != Unavailable
	})
}

// Search is the organisations a name search lists, or, for an EIN, the one it names: a pick from
// it is then filled by the lookup this search already made.
func (c *Client) Search(ctx context.Context, typed string) Search {
	if ein, ok := EIN(typed); ok {
		return c.searchEIN(ctx, ein)
	}
	query := Query(typed)
	if c.base == "" || query == "" {
		return Search{State: SearchUnavailable, Matches: []Match{}}
	}
	missed := Search{State: SearchUnavailable, Matches: []Match{}}
	return c.searches.recall(ctx, query, missed, func(asking context.Context) (Search, bool) {
		searched := c.search(asking, query)
		return searched, searched.State != SearchUnavailable
	})
}

// `GET {API}/v1/orgs/{ein}`, as this console reads it. a fact the IRS files do not hold is null,
// which decodes as empty or false.
type upstreamOrganisation struct {
	EIN     string `json:"ein"`
	Name    string `json:"name"`
	Address struct {
		Street string `json:"street"`
		City   string `json:"city"`
		State  string `json:"state"`
		Zip    string `json:"zip"`
	} `json:"address"`
	Deductible     bool   `json:"deductible"`
	Revoked        bool   `json:"revoked"`
	RevocationDate string `json:"revocationDate"`
	Website        string `json:"website"`
	Mission        string `json:"mission"`
}

// `GET {API}/v1/search?q=&limit=`, as this console reads it. a result carries no revocation.
type upstreamMatches struct {
	Results []struct {
		EIN        string `json:"ein"`
		Name       string `json:"name"`
		City       string `json:"city"`
		State      string `json:"state"`
		Deductible bool   `json:"deductible"`
	} `json:"results"`
}

func (c *Client) lookUp(ctx context.Context, ein string) Lookup {
	said := c.ask(ctx, "/v1/orgs/"+ein)
	switch {
	case said.status == http.StatusOK:
	case said.code == "not_found":
		return Lookup{State: NotFound}
	default:
		return Lookup{State: Unavailable}
	}
	var read upstreamOrganisation
	if json.Unmarshal(said.body, &read) != nil {
		return Lookup{State: Unavailable}
	}
	// an answer about another number fills nothing.
	if answered, _ := EIN(read.EIN); answered != ein {
		return Lookup{State: Unavailable}
	}
	// a record that names nobody is no organisation to fill from, as filing.ts reads it.
	if strings.TrimSpace(read.Name) == "" {
		return Lookup{State: NotFound}
	}
	return Lookup{State: Found, Organisation: Organisation{
		EIN:          ein,
		Name:         read.Name,
		AddressLine1: read.Address.Street,
		City:         read.Address.City,
		Region:       read.Address.State,
		PostalCode:   read.Address.Zip,
		Deductible:   read.Deductible,
		RevokedOn:    read.revokedOn(),
		Website:      read.Website,
		Mission:      cut(strings.TrimSpace(read.Mission), MissionMax),
	}}
}

func (c *Client) searchEIN(ctx context.Context, ein string) Search {
	looked := c.LookUp(ctx, ein)
	switch looked.State {
	case Found:
		found := looked.Organisation
		return Search{State: Listed, Matches: []Match{{
			EIN:        found.EIN,
			Name:       found.Name,
			City:       found.City,
			State:      found.Region,
			Deductible: found.Deductible,
			RevokedOn:  found.RevokedOn,
		}}}
	case NotFound:
		return Search{State: Listed, Matches: []Match{}}
	default:
		return Search{State: SearchUnavailable, Matches: []Match{}}
	}
}

func (c *Client) search(ctx context.Context, query string) Search {
	unavailable := Search{State: SearchUnavailable, Matches: []Match{}}
	said := c.ask(ctx, "/v1/search?q="+url.QueryEscape(query)+"&limit="+strconv.Itoa(mostMatches))
	if said.status != http.StatusOK {
		return unavailable
	}
	var read upstreamMatches
	if json.Unmarshal(said.body, &read) != nil || read.Results == nil {
		return unavailable
	}
	matches := []Match{}
	for _, one := range read.Results {
		// an entry no pick could fill from is left off rather than failing the list.
		ein, ok := EIN(one.EIN)
		if !ok || strings.TrimSpace(one.Name) == "" {
			continue
		}
		matches = append(matches, Match{
			EIN:        ein,
			Name:       one.Name,
			City:       one.City,
			State:      one.State,
			Deductible: one.Deductible,
		})
		if len(matches) == mostMatches {
			break
		}
	}
	return Search{State: Listed, Matches: matches}
}

// the revocation date where the API says revoked, which is its reading of revoked and not
// reinstated since. a revocation with no readable date is no revocation this console can show.
func (read upstreamOrganisation) revokedOn() string {
	if _, err := time.Parse(time.DateOnly, read.RevocationDate); !read.Revoked || err != nil {
		return ""
	}
	return read.RevocationDate
}

// said cut to at most limit UTF-16 code units at a character's edge, with the space a cut ends on
// trimmed; said within the limit is returned as it came.
func cut(said string, limit int) string {
	units := 0
	for at, r := range said {
		units += utf16.RuneLen(r)
		if units > limit {
			return strings.TrimSpace(said[:at])
		}
	}
	return said
}

// one answer of the API's: its status and body, and the `code` a refusal's problem json carries.
// status 0 is no answer to read.
type answer struct {
	status     int
	body       []byte
	code       string
	retryAfter time.Duration
}

// a read, and where the API refuses it for the minute, the one wait it names and one read more.
func (c *Client) ask(ctx context.Context, path string) answer {
	ctx, stop := context.WithTimeout(ctx, c.askWithin)
	defer stop()
	said := c.get(ctx, path)
	if said.code != "per_minute_limit_exceeded" {
		return said
	}
	if !c.wait(ctx, said.retryAfter) {
		return answer{}
	}
	return c.get(ctx, path)
}

func (c *Client) get(ctx context.Context, path string) answer {
	bound, stop := context.WithTimeout(ctx, c.within)
	defer stop()
	request, err := http.NewRequestWithContext(bound, http.MethodGet, c.base+path, nil)
	if err != nil {
		return answer{}
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return answer{}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, answerBytes+1))
	if err != nil || len(body) > answerBytes {
		return answer{}
	}
	said := answer{status: response.StatusCode, body: body}
	if said.status != http.StatusOK {
		var problem struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(body, &problem) == nil {
			said.code = problem.Code
		}
		said.retryAfter = waitOf(response.Header.Get("Retry-After"))
	}
	return said
}

// the wait a `Retry-After` in whole seconds names, at most longestWait, which is also the wait a
// value in no other spelling is given.
func waitOf(header string) time.Duration {
	seconds, err := strconv.Atoi(header)
	if err != nil || seconds < 0 || seconds > int(longestWait/time.Second) {
		return longestWait
	}
	return time.Duration(seconds) * time.Second
}

// d slept, or false where ctx ended first.
func pause(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// what one console run found out, by key.
//
// **an ask, once made, belongs to the run rather than to the caller that made it.** the API counts a
// request it received whether or not anyone waits for the answer, and the find box drops its call
// whenever the operator types on — so the ask runs on its own, bounded by `within` alone, and what it
// finds out is kept for whoever asks next. a caller arriving while the same key is being asked waits
// on that ask rather than making a second; any caller that gives up is answered `missed` alone, and
// changes nothing for the others or for what is kept. an answer `ask` says not to keep is forgotten
// once it is handed out.
type memory[T any] struct {
	held sync.Mutex
	kept map[string]*recalled[T]
}

type recalled[T any] struct {
	done  chan struct{}
	value T
}

func (m *memory[T]) recall(
	ctx context.Context,
	key string,
	missed T,
	ask func(context.Context) (T, bool),
) T {
	m.held.Lock()
	one, asking := m.kept[key]
	if !asking {
		one = &recalled[T]{done: make(chan struct{})}
		m.kept[key] = one
		go m.settle(context.WithoutCancel(ctx), key, one, missed, ask)
	}
	m.held.Unlock()
	select {
	case <-one.done:
		return one.value
	case <-ctx.Done():
		return missed
	}
}

// one ask, run to its end. a panic in it is an answer nobody found out and is not kept: it runs
// outside any handler, where nothing else would catch it before it ended the console.
func (m *memory[T]) settle(
	ctx context.Context,
	key string,
	one *recalled[T],
	missed T,
	ask func(context.Context) (T, bool),
) {
	keep := false
	defer func() {
		if recover() != nil {
			one.value, keep = missed, false
		}
		if !keep {
			m.held.Lock()
			delete(m.kept, key)
			m.held.Unlock()
		}
		close(one.done)
	}()
	one.value, keep = ask(ctx)
}
