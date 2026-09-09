package blake3

import (
	"encoding/hex"
	"testing"
)

// the official test vectors, which are the only thing that says this implementation is blake3.
//
// the input of length n is the 251-byte cycle 0, 1, … 250 repeated, and the digest is the first 32
// bytes of the extended output — both as stated by the reference implementation's own
// test_vectors.json (https://github.com/BLAKE3-team/BLAKE3/blob/master/test_vectors/test_vectors.json).
// the lengths cross every boundary the tree has: inside one block, a full block, a full chunk, the
// first parent node, and several levels of the stack.
//
// **the file states fourteen of the sixteen below.** 5000 and 100000 are not among its lengths and
// their digests were taken from the reference implementation run at those two, which is the same
// authority a length further out than the file goes can have.
var vectors = map[int]string{
	0:      "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
	1:      "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213",
	2:      "7b7015bb92cf0b318037702a6cdd81dee41224f734684c2c122cd6359cb1ee63",
	3:      "e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f",
	63:     "e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b",
	64:     "4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98",
	65:     "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee",
	1023:   "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11",
	1024:   "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7",
	1025:   "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444",
	2048:   "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a",
	2049:   "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030",
	3072:   "b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2",
	4096:   "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969",
	5000:   "ee78d92070de3df1c57c37002abf0a6b1a6589acdeef4d8ffac7cf3d9e8f2836",
	100000: "d93c23eedaf165a7e0be908ba86f1a7a520d568d2d13cde787c8580c5c72cc54",
}

// the input the vectors above are of, which the reference implementation calls the test pattern.
func pattern(length int) []byte {
	input := make([]byte, length)
	for at := range input {
		input[at] = byte(at % 251)
	}
	return input
}

func TestTheDigestsAreTheOnesTheSpecStates(t *testing.T) {
	for length, want := range vectors {
		digest := Sum(pattern(length))
		got := hex.EncodeToString(digest[:])
		if got != want {
			t.Errorf("Sum(pattern(%d)) = %s, want %s", length, got, want)
		}
	}
}

func TestAWriteInPiecesIsTheSameDigestAsOne(t *testing.T) {
	// the assets manifest hashes one file at a time, so nothing in this binary writes in pieces —
	// what this holds is that the chunk buffer carries state across a write rather than
	// hashing whatever arrived as if it were the whole input.
	input := pattern(5000)
	for _, piece := range []int{1, 7, 64, 1000, 1024} {
		hasher := New()
		for at := 0; at < len(input); at += piece {
			end := min(at+piece, len(input))
			hasher.Write(input[at:end])
		}
		digest := hasher.Sum()
		got := hex.EncodeToString(digest[:])
		if got != vectors[5000] {
			t.Errorf("written %d bytes at a time = %s, want %s", piece, got, vectors[5000])
		}
	}
}
