import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel-decorative/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";

import { boot } from "./lib/account";

// Erst prüfen, ob jemand angemeldet ist (und den Stand aus dem Konto laden) – dann die App, sonst die Anmeldeseite.
void (async () => {
  const s = await boot().catch(() => null);
  if (s) await import("./app");
  else (await import("./pages/login")).showLogin();
})();
