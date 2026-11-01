// Media the browser tier and the screenshot description upload, small enough to keep in source as
// base64. summary.pdf, 549 B: one 300 x 200 pt page reading "Run summary" in Helvetica, which a
// real Chrome renders. Its bytes are copied from spike-html-apps-components (v0.8.0),
// test/fixtures/media.js, where qpdf --check accepts them.

/** A one-page PDF's bytes, application/pdf. */
export const summaryPdf = (): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    Buffer.from(
      "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9U" +
        "eXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50" +
        "IDIgMCBSL01lZGlhQm94WzAgMCAzMDAgMjAwXS9Db250ZW50cyA0IDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjEg" +
        "NSAwIFI+Pj4+Pj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQyPj5zdHJlYW0KQlQgL0YxIDI0IFRmIDQwIDEw" +
        "MCBUZCAoUnVuIHN1bW1hcnkpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PC9UeXBlL0ZvbnQvU3Vi" +
        "dHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBm" +
        "IAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDEwNSAwMDAwMCBuIAowMDAw" +
        "MDAwMjE3IDAwMDAwIG4gCjAwMDAwMDAzMDYgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDYvUm9vdCAxIDAgUj4+" +
        "CnN0YXJ0eHJlZgozNjkKJSVFT0YK",
      "base64",
    ),
  );
