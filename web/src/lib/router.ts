// Hash-Router mit animierten Seitenübergängen.

export interface Page {
  render(root: HTMLElement, params: Record<string, string>): void | Promise<void>;
  /** Aufräumen beim Verlassen (Ereignisse, Renderer, Timer). */
  leave?(): void;
}

interface Route { pattern: RegExp; keys: string[]; page: () => Page; nav: string }

const routes: Route[] = [];
let current: Page | null = null;
let root: HTMLElement;
let onNavigate: (nav: string) => void = () => {};

export function route(path: string, nav: string, page: () => Page) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ pattern, keys, page, nav });
}

export function go(path: string) {
  if (location.hash === `#${path}`) void resolve(false);
  else location.hash = path;
}

export function startRouter(el: HTMLElement, navigate: (nav: string) => void) {
  root = el;
  onNavigate = navigate;
  addEventListener("hashchange", () => void resolve(false));
  void resolve(true);
}

async function swap(page: Page, params: Record<string, string>) {
  current?.leave?.();
  current = page;
  // Frisches Element: Seiten hängen Klick-Reaktionen an `root` – ohne Austausch sammelten sie sich bei jedem Besuch an
  // (z. B. fünf Löschen-Rückfragen nach fünf Besuchen, oder ein alter Figuren-Entwurf, der mitgespeichert wurde).
  const fresh = root.cloneNode(false) as HTMLElement;
  root.replaceWith(fresh);
  root = fresh;
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  await page.render(root, params);
  root.focus({ preventScroll: true });
}

async function resolve(first: boolean) {
  const path = location.hash.replace(/^#/, "") || "/";
  const r = routes.find((x) => x.pattern.test(path));
  if (!r) return go("/");
  const m = path.match(r.pattern)!;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  onNavigate(r.nav);
  const page = r.page();
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
  if (!first && doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    doc.startViewTransition(() => swap(page, params));
    return;
  }
  await swap(page, params);
  root.classList.remove("page-enter");
  void root.offsetWidth;
  root.classList.add("page-enter");
}
