/**
 * Transición de pantalla completa entre páginas (landing ↔ acceso ↔ registro).
 * Vive en <body>, así sobrevive al cambio de ruta: cubre la pantalla, navega y se retira
 * cuando la página nueva ya está dibujada. Sin dependencias ni estilos globales externos.
 */
export type RouteTransitionMode = "iris" | "curtain" | "card";

export interface RouteTransitionRequest {
  readonly mode: RouteTransitionMode;
  readonly label: string;
  readonly kicker?: string;
  /** Punto de origen (iris). */
  readonly x?: number;
  readonly y?: number;
  /** Rectángulo que crece hasta llenar la pantalla (card). */
  readonly from?: DOMRect | null;
}

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const STYLE_ID = "ac-route-transition-style";
let running = false;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ac-rt { position: fixed; inset: 0; z-index: 2147483000; pointer-events: all; overflow: hidden; }
.ac-rt-layer { position: absolute; inset: 0; background: radial-gradient(70% 60% at 80% 10%, rgba(155, 140, 255, .55), transparent 70%), radial-gradient(60% 50% at 0% 100%, rgba(34, 211, 238, .3), transparent 70%), linear-gradient(150deg, #2354bb, #183e90 65%, #0d1f52); }
.ac-rt-strips { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(6, 1fr); }
.ac-rt-strips i { background: linear-gradient(180deg, #2354bb, #142d6e); transform-origin: 50% 100%; }
.ac-rt-strips i:nth-child(even) { background: linear-gradient(180deg, #4d7dff, #2354bb); }
.ac-rt-card { position: absolute; background: linear-gradient(150deg, #2354bb, #183e90 65%, #0d1f52); box-shadow: 0 40px 120px rgba(7, 8, 12, .45); overflow: hidden; }
.ac-rt-label { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 14px; text-align: center; color: #fff; font-family: "Inter Display", Inter, "Segoe UI", system-ui, sans-serif; z-index: 2; }
.ac-rt-label small { font: 700 13px Inter, "Segoe UI", system-ui, sans-serif; letter-spacing: .3em; text-transform: uppercase; opacity: .8; }
.ac-rt-label b { font-weight: 800; letter-spacing: -.045em; line-height: .95; font-size: clamp(48px, 9vw, 150px); text-shadow: 0 20px 60px rgba(7, 8, 12, .35); }
.ac-rt-label span { display: block; width: min(220px, 50vw); height: 3px; border-radius: 3px; background: rgba(255, 255, 255, .25); overflow: hidden; }
.ac-rt-label span::after { content: ""; display: block; height: 100%; width: 40%; border-radius: inherit; background: #fff; animation: ac-rt-load 0.9s ease-in-out infinite; }
@keyframes ac-rt-load { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
`;
  document.head.appendChild(style);
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
/** Espera una animación, pero nunca más de `ms` (pestañas en segundo plano pausan las animaciones). */
const settle = (animations: Animation[], ms: number) => Promise.race([Promise.all(animations.map((a) => a.finished)).then(() => undefined), wait(ms)]);
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Ejecuta la transición y llama a `navigate` cuando la pantalla ya está cubierta. */
export function runRouteTransition(request: RouteTransitionRequest, navigate: () => unknown): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (running) return;
  if (reduced || typeof document.body.animate !== "function") {
    void navigate();
    return;
  }
  running = true;
  ensureStyle();
  const root = document.createElement("div");
  root.className = "ac-rt";
  root.setAttribute("aria-hidden", "true");
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = request.x ?? w / 2;
  const y = request.y ?? h / 2;
  let cover: Animation[] = [];
  let surface: HTMLElement;

  if (request.mode === "curtain") {
    surface = document.createElement("div");
    surface.className = "ac-rt-strips";
    for (let i = 0; i < 6; i++) surface.appendChild(document.createElement("i"));
    root.appendChild(surface);
    cover = Array.from(surface.children).map((strip, i) =>
      strip.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 560, delay: i * 55, easing: EASE, fill: "both" }),
    );
  } else if (request.mode === "card" && request.from) {
    const r = request.from;
    surface = document.createElement("div");
    surface.className = "ac-rt-card";
    root.appendChild(surface);
    cover = [
      surface.animate(
        [
          { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "28px", opacity: 0.6 },
          { left: "0px", top: "0px", width: `${w}px`, height: `${h}px`, borderRadius: "0px", opacity: 1 },
        ],
        { duration: 720, easing: EASE, fill: "both" },
      ),
    ];
  } else {
    surface = document.createElement("div");
    surface.className = "ac-rt-layer";
    root.appendChild(surface);
    const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 20;
    cover = [
      surface.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${radius}px at ${x}px ${y}px)` }], {
        duration: 680,
        easing: EASE,
        fill: "both",
      }),
    ];
  }

  const label = document.createElement("div");
  label.className = "ac-rt-label";
  const kicker = document.createElement("small");
  kicker.textContent = request.kicker ?? "Vamos a";
  const title = document.createElement("b");
  title.textContent = request.label;
  const bar = document.createElement("span");
  label.append(kicker, title, bar);
  root.appendChild(label);
  document.body.appendChild(root);
  label.animate(
    [
      { opacity: 0, transform: "translateY(40px) scale(.96)", filter: "blur(8px)" },
      { opacity: 1, transform: "none", filter: "blur(0px)" },
    ],
    { duration: 600, delay: 220, easing: EASE, fill: "both" },
  );

  void (async () => {
    try {
      await settle(cover, 1000);
      await Promise.resolve(navigate());
      await wait(260);
      await Promise.race([nextPaint(), wait(200)]);
      // salida: la cortina sube y deja ver la página nueva
      label.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-30px)" }], { duration: 300, easing: "ease-in", fill: "both" });
      const out = root.animate(
        [
          { transform: "translateY(0)", borderRadius: "0 0 0 0" },
          { transform: "translateY(-100%)", borderRadius: "0 0 50% 50% / 0 0 18% 18%" },
        ],
        { duration: 760, delay: 120, easing: "cubic-bezier(0.7, 0, 0.2, 1)", fill: "both" },
      );
      await settle([out], 1100);
    } catch {
      /* si algo falla, igual se retira la capa */
    } finally {
      root.remove();
      running = false;
    }
  })();
}

/** Decide la transición según el destino del enlace. */
export function transitionForHref(href: string, element: Element): RouteTransitionRequest {
  const path = href.replace(/^https?:\/\/[^/]+/, "");
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (path.startsWith("/login")) return { mode: "curtain", label: "Acceso", kicker: "Bienvenido de vuelta" };
  if (path.startsWith("/register")) return { mode: "iris", label: "Crea tu cuenta", kicker: "Empecemos", x, y };
  if (path.startsWith("/forgot") || path.startsWith("/reset")) return { mode: "iris", label: "Recuperar acceso", kicker: "Un momento", x, y };
  if (path.startsWith("/verify")) return { mode: "iris", label: "Verificar correo", kicker: "Último paso", x, y };
  if (path.includes("#precios")) return { mode: "curtain", label: "Precios", kicker: "Vamos a" };
  if (path.includes("#funciones")) return { mode: "curtain", label: "Funciones", kicker: "Vamos a" };
  if (path.includes("#como-funciona")) return { mode: "curtain", label: "Cómo funciona", kicker: "Vamos a" };
  return { mode: "curtain", label: "AutoClipper", kicker: "Volviendo a" };
}

/** Intercepta clics en enlaces internos de `host` y los navega con transición. */
export function interceptRouteLinks(
  host: HTMLElement,
  navigate: (url: string) => unknown,
  pick: (anchor: HTMLAnchorElement) => RouteTransitionRequest | null = (anchor) => transitionForHref(anchor.getAttribute("href") ?? "/", anchor),
): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !host.contains(anchor) || anchor.target === "_blank" || anchor.hasAttribute("data-goto")) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    const current = location.pathname + location.search;
    if (href === current) return;
    const request = pick(anchor);
    if (!request) return;
    event.preventDefault();
    event.stopPropagation();
    // Los enlaces con #sección cargan la landing directamente en esa escena
    const go = href.includes("#") ? () => location.assign(href) : () => navigate(href);
    runRouteTransition(request, go);
  };
  host.addEventListener("click", onClick, true);
  return () => host.removeEventListener("click", onClick, true);
}
