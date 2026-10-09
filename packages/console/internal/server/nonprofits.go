package server

import (
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/better-giving/console/internal/nonprofits"
)

// finding the organisation in the IRS nonprofit API, for the Organisation details fold to fill from.
//
// **two reads, and the only two doors that spend the API.** nothing on load, nothing at start-up and
// no other route asks it: the API is sized for set-up, so it is asked when the operator asks and at
// no other time. what is asked twice in a run is answered from internal/nonprofits' memory. the
// status is a third door and asks nothing: whether this binary was built with the API's address at
// all, so a screen can leave out a search whose every answer would be `unavailable`.
//
// **a read that could not be made is an answer and never a refusal**: `unavailable` at 200, so the
// fold leaves the boxes as typed and set-up goes on without it. a 400 names the value and the box it
// came from: a query under searchFewest or past searchMost, counted in runes, one the API would
// refuse or cut — no word in it, or more than searchWords, as searchWordsOf reads them — or a path
// that is no EIN. a refusal of the API's would read as `unavailable`, which says the API is down.
//
// every field of `organisation` is written in every state, empty unless found
// (packages/console-ui/src/api/types.ts' header).

// the fewest characters a search is made on, which is what keeps a box being typed in from asking
// the API per keystroke.
const searchFewest = 3

// the most, past which nothing typed is a name: the longest legal names on the IRS lists are well
// under it.
const searchMost = 200

// the most words a search is made on: the API searches the first 8 and drops the rest, so a ninth
// would be typed for nothing.
const searchWords = 8

func nonprofitRoutes(routes *http.ServeMux, lookups *nonprofits.Client) {
	routes.HandleFunc("GET /api/nonprofits/status", func(w http.ResponseWriter, _ *http.Request) {
		answer(w, http.StatusOK, map[string]bool{"built": lookups.Built()})
	})
	routes.HandleFunc("GET /api/nonprofits/search", func(w http.ResponseWriter, r *http.Request) {
		typed := r.URL.Query().Get("q")
		length := utf8.RuneCountInString(nonprofits.Query(typed))
		if length < searchFewest || length > searchMost {
			answer(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf(
				"the search box needs %d to %d characters, and %q is %d", searchFewest, searchMost,
				typed, length)})
			return
		}
		switch words := searchWordsOf(typed); {
		case words == 0:
			answer(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf(
				"the search box needs a letter or a digit, and %q has none", typed)})
			return
		case words > searchWords:
			answer(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf(
				"the search box takes at most %d words, and %q is %d: type a few distinctive words of the name",
				searchWords, typed, words)})
			return
		}
		answer(w, http.StatusOK, lookups.Search(r.Context(), typed))
	})
	routes.HandleFunc("GET /api/nonprofits/{ein}", func(w http.ResponseWriter, r *http.Request) {
		typed := r.PathValue("ein")
		if _, ok := nonprofits.EIN(typed); !ok {
			answer(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf(
				"%q is not an EIN: the EIN box takes nine digits, as 12-3456789 or 123456789", typed)})
			return
		}
		answer(w, http.StatusOK, lookups.LookUp(r.Context(), typed))
	})
}

// how many words the API reads in typed (https://nonprofits.better.giving: punctuation is ignored and
// at most 8 words are used): runs of letters and digits, with apostrophes dropped first and each word
// counted once whatever its case. an accent typed apart from its letter stays in the word, as the
// API's NFC composes the two before it reads them.
func searchWordsOf(typed string) int {
	seen := map[string]bool{}
	var word strings.Builder
	end := func() {
		if word.Len() > 0 {
			seen[strings.ToLower(word.String())] = true
			word.Reset()
		}
	}
	for _, r := range typed {
		switch {
		case r == '\'' || r == '\u2019':
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			word.WriteRune(r)
		case unicode.IsMark(r) && word.Len() > 0:
			word.WriteRune(r)
		default:
			end()
		}
	}
	end()
	return len(seen)
}
