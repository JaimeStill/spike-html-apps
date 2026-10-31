// The second module the shell loads render-blocking, after register.ts: the foundation's
// preferences module, which applies the reader's stored theme choice to the root element before
// the browser paints, follows another tab's save, and defines <sl-theme-menu>.

import "@jaimestill/spike-html-apps-foundation/preferences.js";
