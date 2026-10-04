// Package nonprofits is the console's door to the IRS nonprofit API, which finds the organisation an
// operator is setting up for: by EIN, or by a search over names.
//
// **one fixed address, and nothing reads another.** every console is built with API, and no env
// var, flag or record may point a console elsewhere: what comes back fills the legal identity a
// receipt is printed under, so the source is the build's to name. a test builds a client on its own
// upstream with At. the deployment reads the same API for its page AI, and
// `packages/app/src/lib/server/nonprofits/filing.ts` holds its copy of the address and the shape:
// the two change together.
//
// **every failure is an answer, and `unavailable` is all of them.** no address, no route, a timeout,
// a status other than 200 or 404, a body past answerBytes or in a shape decoded nowhere below — the
// fold leaves the boxes as typed and set-up goes on by hand, so none of these is an error to anyone.
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
	"strings"
	"sync"
	"time"
)

// API is where the IRS nonprofit API answers. empty is no address: every call answers `unavailable`
// and makes no request.
const API = ""

// how long one request may take before the API counts as not answering: a box waits on it.
const within = 5 * time.Second

// the most of one answer read, past which it is no answer: a lookup is one organisation and a search
// at most a page of them.
const answerBytes = 256 << 10

// the most matches one search keeps, in the API's order.
const mostMatches = 10

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

// Organisation is one organisation's legal details as the Legal details fold fills them, under the
// names it gives its boxes (packages/console-ui/src/lib/org-fields.ts) where it fills one. EIN is
// the nine digits with no dash; RevokedOn is the `YYYY-MM-DD` its tax-exempt status was revoked on,
// empty where it is not revoked or was reinstated since. every field is empty unless Found.
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
}

// Lookup is one lookup by EIN.
type Lookup struct {
	State        LookupState  `json:"state"`
	Organisation Organisation `json:"organisation"`
}

// Match is one organisation a search listed, in the fields a pick is made by. State is the US
// state, as Organisation's Region is.
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
	base     string
	http     *http.Client
	within   time.Duration
	lookups  memory[Lookup]
	searches memory[Search]
}

// New is a client on API.
func New() *Client { return At(API) }

// At is a client on another address, which is a test upstream everywhere but New.
func At(base string) *Client {
	return &Client{
		base:     strings.TrimSuffix(base, "/"),
		http:     &http.Client{},
		within:   within,
		lookups:  memory[Lookup]{kept: map[string]*recalled[Lookup]{}},
		searches: memory[Search]{kept: map[string]*recalled[Search]{}},
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

// `GET {API}/v1/organizations/{ein}`, as this console reads it.
type upstreamOrganisation struct {
	EIN     string `json:"ein"`
	Name    string `json:"name"`
	Address struct {
		Street string `json:"street"`
		City   string `json:"city"`
		State  string `json:"state"`
		Zip    string `json:"zip"`
	} `json:"address"`
	Status upstreamStatus `json:"status"`
	Filing struct {
		Website *string `json:"website"`
	} `json:"filing"`
}

// `GET {API}/v1/organizations?q=`, as this console reads it.
type upstreamMatches struct {
	Results []struct {
		EIN    string         `json:"ein"`
		Name   string         `json:"name"`
		City   string         `json:"city"`
		State  string         `json:"state"`
		Status upstreamStatus `json:"status"`
	} `json:"results"`
}

type upstreamStatus struct {
	Deductible        bool    `json:"deductible"`
	Revoked           bool    `json:"revoked"`
	RevocationDate    *string `json:"revocation_date"`
	ReinstatementDate *string `json:"reinstatement_date"`
}

func (c *Client) lookUp(ctx context.Context, ein string) Lookup {
	status, body := c.get(ctx, "/v1/organizations/"+ein)
	switch status {
	case http.StatusOK:
	case http.StatusNotFound:
		return Lookup{State: NotFound}
	default:
		return Lookup{State: Unavailable}
	}
	var read upstreamOrganisation
	if json.Unmarshal(body, &read) != nil {
		return Lookup{State: Unavailable}
	}
	// an answer about another number, or about nobody, fills nothing.
	if said, _ := EIN(read.EIN); said != ein || strings.TrimSpace(read.Name) == "" {
		return Lookup{State: Unavailable}
	}
	return Lookup{State: Found, Organisation: Organisation{
		EIN:          ein,
		Name:         read.Name,
		AddressLine1: read.Address.Street,
		City:         read.Address.City,
		Region:       read.Address.State,
		PostalCode:   read.Address.Zip,
		Deductible:   read.Status.Deductible,
		RevokedOn:    read.Status.revokedOn(),
		Website:      orEmpty(read.Filing.Website),
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
	status, body := c.get(ctx, "/v1/organizations?q="+url.QueryEscape(query))
	if status != http.StatusOK {
		return unavailable
	}
	var read upstreamMatches
	if json.Unmarshal(body, &read) != nil || read.Results == nil {
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
			Deductible: one.Status.Deductible,
			RevokedOn:  one.Status.revokedOn(),
		})
		if len(matches) == mostMatches {
			break
		}
	}
	return Search{State: Listed, Matches: matches}
}

// the revocation date where the status is revoked and no later reinstatement undid it — a
// reinstatement after the revocation is not revoked whichever way the API left the flag. a revocation
// with no readable date is no revocation this console can show.
func (status upstreamStatus) revokedOn() string {
	revoked, readable := day(status.RevocationDate)
	if !status.Revoked || !readable {
		return ""
	}
	if reinstated, ok := day(status.ReinstatementDate); ok && reinstated.After(revoked) {
		return ""
	}
	return *status.RevocationDate
}

func day(said *string) (time.Time, bool) {
	if said == nil {
		return time.Time{}, false
	}
	read, err := time.Parse(time.DateOnly, *said)
	return read, err == nil
}

func orEmpty(said *string) string {
	if said == nil {
		return ""
	}
	return *said
}

// one read, answered with its status and body, or status 0 where there was no answer to read.
func (c *Client) get(ctx context.Context, path string) (int, []byte) {
	bound, stop := context.WithTimeout(ctx, c.within)
	defer stop()
	request, err := http.NewRequestWithContext(bound, http.MethodGet, c.base+path, nil)
	if err != nil {
		return 0, nil
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return 0, nil
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, answerBytes+1))
	if err != nil || len(body) > answerBytes {
		return 0, nil
	}
	return response.StatusCode, body
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
