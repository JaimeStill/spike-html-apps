package search

// Context is how many runes a snippet keeps on each side of its match.
const Context = 40

// Field names where a document matched: the field its snippet is from.
type Field string

// The fields a search reads.
const (
	InName    Field = "name"
	InContent Field = "content"
)

// Match is one document a search found, as the API presents it: the
// document's id and name, the field the snippet is from, and the snippet.
type Match struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Field   Field  `json:"field"`
	Snippet string `json:"snippet"`
}
