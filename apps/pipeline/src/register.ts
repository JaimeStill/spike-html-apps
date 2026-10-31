// The first module the shell loads render-blocking (apps/pipeline/pipeline.go's RenderBlocking): the
// foundation's full page entry, whose stylesheet the manifest names as this module's CSS, and its
// full registration module, which registers every built-in profile, so the theme menu offers them
// all and preferences.ts, which runs next, finds each stored name registered.

import "@jaimestill/spike-html-apps-foundation/page-full.css";
import "@jaimestill/spike-html-apps-foundation/register-full.js";
