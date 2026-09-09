// Package blake3 is the hash cloudflare's assets manifest is keyed by, written in-tree for a binary
// that depends on nothing.
//
// **it is here because the manifest hash is blake3 and go's standard library has no blake3.** an
// upload session is opened by sending a manifest whose every entry is
// `blake3(base64(fileBytes) + extensionWithoutDot)` truncated to 32 hex characters, and cloudflare
// answers with the buckets it does not already hold — so a wrong digest is not a rejected request
// but an upload of the wrong files under the right names. this module and go.mod holding no
// requirements are the same decision: the binary is downloaded by an operator and built by
// `CGO_ENABLED=0 go build`, and one dependency is a supply chain the release has to watch.
//
// **it is the default hash and nothing else.** no keyed hash, no key derivation, and 32 bytes of
// output rather than the extendable stream — those are the three modes the manifest does not use,
// and code no call reaches is code nothing holds to the spec. ./blake3_test.go carries the
// reference implementation's own vectors, which is what says this is blake3 rather than something
// that resembles it.
//
// the structure is the one the specification's reference implementation states: input in 1024-byte
// chunks, each chunk's chaining value merged into a stack of subtree parents, and the root node
// compressed once more with the root flag.
package blake3

import "encoding/binary"

// how many bytes one chunk of input holds before it becomes a leaf of the tree.
const chunkLen = 1024

// how many bytes one compression takes.
const blockLen = 64

// what a compression is told about the position of the block it is taking.
const (
	flagChunkStart uint32 = 1 << 0
	flagChunkEnd   uint32 = 1 << 1
	flagParent     uint32 = 1 << 2
	flagRoot       uint32 = 1 << 3
)

// the initialisation vector, which is sha-256's and is the key an unkeyed hash starts from.
var iv = [8]uint32{
	0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
	0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
}

// how the message words are reordered between rounds.
var permutation = [16]int{2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8}

// Sum is the 32-byte digest of one input.
func Sum(input []byte) [32]byte {
	hasher := New()
	hasher.Write(input)
	return hasher.Sum()
}

// Hasher is one digest being taken, over input that may arrive in pieces.
type Hasher struct {
	chunk chunkState
	// stack holds the chaining value of every completed subtree not yet merged into a larger one.
	// its depth is bounded by the number of bits in a chunk counter, so 54 entries is past any
	// input a process can hold.
	stack  [54][8]uint32
	depth  int
	merged uint64
}

// New is a digest to write input into.
func New() *Hasher { return &Hasher{chunk: newChunk(0)} }

// Write adds input to the digest. It never fails, and the whole of `input` is always taken.
func (hasher *Hasher) Write(input []byte) (int, error) {
	written := len(input)
	for len(input) > 0 {
		if hasher.chunk.filled() == chunkLen {
			hasher.merged++
			hasher.merge(hasher.chunk.output().chainingValue(), hasher.merged)
			hasher.chunk = newChunk(hasher.merged)
		}
		took := min(chunkLen-hasher.chunk.filled(), len(input))
		hasher.chunk.write(input[:took])
		input = input[took:]
	}
	return written, nil
}

// Sum is the digest of everything written so far, which leaves the hasher usable for more.
func (hasher *Hasher) Sum() [32]byte {
	// the tree is finished from the last chunk upwards: every entry still on the stack is a subtree
	// to the left of it, so each one becomes the parent of what has been folded so far.
	node := hasher.chunk.output()
	for at := hasher.depth - 1; at >= 0; at-- {
		node = parentOutput(hasher.stack[at], node.chainingValue())
	}
	return node.rootDigest()
}

// merges one finished chunk's chaining value into the stack.
//
// a subtree is complete exactly when the number of chunks below it is a power of two, which is what
// the trailing zero bits of the count say: each one is a parent to fold before the value is pushed.
func (hasher *Hasher) merge(cv [8]uint32, chunks uint64) {
	for chunks&1 == 0 {
		hasher.depth--
		cv = parentOutput(hasher.stack[hasher.depth], cv).chainingValue()
		chunks >>= 1
	}
	hasher.stack[hasher.depth] = cv
	hasher.depth++
}

// one compression that has not been made yet, so that the caller states the root flag.
//
// a chunk's last block and a parent node are the same thing at this point — a chaining value, a
// block of message words and the flags they are taken under — and which of the two it is stops
// mattering once it is one of these.
type output struct {
	cv      [8]uint32
	block   [16]uint32
	counter uint64
	length  uint32
	flags   uint32
}

func (node output) chainingValue() [8]uint32 {
	return chainingValue(compress(node.cv, node.block, node.counter, node.length, node.flags))
}

// the digest of the whole tree, which is the one compression the root flag is set on.
func (node output) rootDigest() [32]byte {
	state := compress(node.cv, node.block, node.counter, node.length, node.flags|flagRoot)
	var digest [32]byte
	for at := range 8 {
		binary.LittleEndian.PutUint32(digest[at*4:], state[at])
	}
	return digest
}

// one chunk of input, taken a block at a time.
type chunkState struct {
	cv       [8]uint32
	counter  uint64
	block    [blockLen]byte
	blockLen int
	blocks   int
}

func newChunk(counter uint64) chunkState {
	return chunkState{cv: iv, counter: counter}
}

func (chunk *chunkState) filled() int { return blockLen*chunk.blocks + chunk.blockLen }

// the flag that says this is the first block of its chunk, which only the first block carries.
func (chunk *chunkState) startFlag() uint32 {
	if chunk.blocks == 0 {
		return flagChunkStart
	}
	return 0
}

func (chunk *chunkState) write(input []byte) {
	for len(input) > 0 {
		// the block is compressed only once the next byte arrives, because the last block of a
		// chunk carries the end flag and nothing knows it is the last until the input runs out.
		if chunk.blockLen == blockLen {
			chunk.cv = chainingValue(compress(chunk.cv, words(chunk.block), chunk.counter, blockLen, chunk.startFlag()))
			chunk.blocks++
			chunk.block = [blockLen]byte{}
			chunk.blockLen = 0
		}
		took := min(blockLen-chunk.blockLen, len(input))
		copy(chunk.block[chunk.blockLen:], input[:took])
		chunk.blockLen += took
		input = input[took:]
	}
}

// what this chunk's last block compresses to.
func (chunk *chunkState) output() output {
	return output{
		cv:      chunk.cv,
		block:   words(chunk.block),
		counter: chunk.counter,
		length:  uint32(chunk.blockLen),
		flags:   chunk.startFlag() | flagChunkEnd,
	}
}

// the node joining two subtrees.
func parentOutput(left, right [8]uint32) output {
	var block [16]uint32
	copy(block[:8], left[:])
	copy(block[8:], right[:])
	return output{cv: iv, block: block, length: blockLen, flags: flagParent}
}

func chainingValue(state [16]uint32) [8]uint32 {
	return [8]uint32(state[:8])
}

// one compression, which is the whole of blake3's arithmetic.
func compress(cv [8]uint32, block [16]uint32, counter uint64, length, flags uint32) [16]uint32 {
	state := [16]uint32{
		cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
		iv[0], iv[1], iv[2], iv[3],
		uint32(counter), uint32(counter >> 32), length, flags,
	}

	message := block
	for round := range 7 {
		mix(&state, &message)
		if round < 6 {
			var next [16]uint32
			for at, from := range permutation {
				next[at] = message[from]
			}
			message = next
		}
	}

	for at := range 8 {
		state[at] ^= state[at+8]
		state[at+8] ^= cv[at]
	}
	return state
}

// one round: four columns, then four diagonals.
func mix(state *[16]uint32, m *[16]uint32) {
	g(state, 0, 4, 8, 12, m[0], m[1])
	g(state, 1, 5, 9, 13, m[2], m[3])
	g(state, 2, 6, 10, 14, m[4], m[5])
	g(state, 3, 7, 11, 15, m[6], m[7])
	g(state, 0, 5, 10, 15, m[8], m[9])
	g(state, 1, 6, 11, 12, m[10], m[11])
	g(state, 2, 7, 8, 13, m[12], m[13])
	g(state, 3, 4, 9, 14, m[14], m[15])
}

func g(state *[16]uint32, a, b, c, d int, mx, my uint32) {
	state[a] = state[a] + state[b] + mx
	state[d] = rotate(state[d]^state[a], 16)
	state[c] = state[c] + state[d]
	state[b] = rotate(state[b]^state[c], 12)
	state[a] = state[a] + state[b] + my
	state[d] = rotate(state[d]^state[a], 8)
	state[c] = state[c] + state[d]
	state[b] = rotate(state[b]^state[c], 7)
}

func rotate(value uint32, by uint32) uint32 { return value>>by | value<<(32-by) }

func words(block [blockLen]byte) [16]uint32 {
	var out [16]uint32
	for at := range out {
		out[at] = binary.LittleEndian.Uint32(block[at*4:])
	}
	return out
}
