import type { LandingVideo } from "./landing-media";

/**
 * Motor de la landing, sin dependencias.
 *
 * La página no hace scroll nativo: la rueda, el touch y el teclado mueven una
 * posición virtual. Cada escena ocupa toda la pantalla, tiene su propio tramo de
 * progreso interno y pasa a la siguiente con una transición distinta (zoom, iris,
 * deslizamiento lateral, diagonal, tarjeta, cortina, elevación). Al soltar a mitad
 * de una transición, se completa sola hacia el lado en que ibas.
 */
export interface LandingMotionOptions {
  readonly reducedMotion: boolean;
  readonly finePointer: boolean;
  readonly skipIntro: boolean;
  readonly media: Readonly<Record<string, LandingVideo>>;
  readonly onIntroDone?: () => void;
}

type TransitionKind = "zoom" | "iris" | "slide" | "diagonal" | "card" | "wipe" | "lift";

interface Scene {
  readonly el: HTMLElement;
  readonly id: string;
  readonly len: number;
  readonly out: TransitionKind | null;
  start: number;
  holdEnd: number;
  end: number;
}

const TRANSITION = 1; // largo de cada transición, en pantallas
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const hms = (s: number) => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;

export function splitLetters(element: HTMLElement): void {
  if (element.dataset["splitDone"]) return;
  const text = element.textContent ?? "";
  element.setAttribute("aria-label", text.trim());
  element.textContent = "";
  let index = 0;
  let wordIndex = 0;
  text.split(/(\s+)/).forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) {
      element.appendChild(document.createTextNode(" "));
      return;
    }
    // Cada palabra en un bloque que no se parte; dentro, una caja por letra.
    const word = document.createElement("span");
    word.className = "acl-wordbox";
    word.setAttribute("aria-hidden", "true");
    word.style.setProperty("--w", String(wordIndex++));
    [...part].forEach((character) => {
      const span = document.createElement("span");
      span.className = "acl-char";
      span.style.setProperty("--i", String(index++));
      span.textContent = character;
      word.appendChild(span);
    });
    element.appendChild(word);
  });
  element.dataset["splitDone"] = "1";
}

function applyMedia(root: HTMLElement, media: LandingMotionOptions["media"]): void {
  root.querySelectorAll<HTMLVideoElement>("video[data-video]").forEach((video) => {
    const entry = media[video.dataset["video"] ?? ""];
    if (!entry) return;
    video.poster = entry.poster;
    if (entry.src) video.src = entry.src;
  });
}

function resetLayer(el: HTMLElement): void {
  el.style.transform = "";
  el.style.clipPath = "";
  el.style.opacity = "";
  el.style.filter = "";
  el.style.borderRadius = "";
  el.style.zIndex = "";
}

/** Aplica la transición `kind` entre la escena que sale (a) y la que entra (b). */
function applyTransition(kind: TransitionKind, a: HTMLElement, b: HTMLElement, t: number, reduced: boolean): void {
  const e = easeInOut(t);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (reduced) {
    a.style.zIndex = "1";
    b.style.zIndex = "2";
    b.style.opacity = String(e);
    return;
  }
  const radius = Math.hypot(w, h) / 2 + 20;
  switch (kind) {
    case "zoom": // la que sale se encoge como una tarjeta y revela la siguiente detrás
      a.style.zIndex = "2";
      b.style.zIndex = "1";
      a.style.transform = `translate3d(0, ${-e * 14}%, 0) scale(${1 - 0.32 * e})`;
      a.style.borderRadius = `${e * 40}px`;
      a.style.opacity = String(1 - seg(t, 0.55, 1));
      b.style.transform = `scale(${1.18 - 0.18 * e})`;
      b.style.filter = `brightness(${0.4 + 0.6 * e})`;
      break;
    case "iris": // círculo que se abre desde el centro
      a.style.zIndex = "1";
      b.style.zIndex = "2";
      b.style.clipPath = `circle(${(e * radius).toFixed(1)}px at 50% 55%)`;
      a.style.transform = `scale(${1 + 0.1 * e})`;
      a.style.filter = `brightness(${1 - 0.6 * e})`;
      break;
    case "slide": { // empuje lateral con un pequeño "respiro" de escala
      const dip = 1 - 0.14 * Math.sin(Math.PI * t);
      const r = `${Math.sin(Math.PI * t) * 36}px`;
      a.style.zIndex = "1";
      b.style.zIndex = "2";
      a.style.transform = `translate3d(${-e * 100}%, 0, 0) scale(${dip})`;
      b.style.transform = `translate3d(${(1 - e) * 100}%, 0, 0) scale(${dip})`;
      a.style.borderRadius = r;
      b.style.borderRadius = r;
      break;
    }
    case "diagonal": { // borde inclinado que barre de izquierda a derecha
      const x = e * 170 - 35;
      a.style.zIndex = "1";
      b.style.zIndex = "2";
      b.style.clipPath = `polygon(0 0, ${x + 35}% 0, ${x}% 100%, 0 100%)`;
      a.style.transform = `translate3d(${e * 12}%, 0, 0)`;
      a.style.filter = `brightness(${1 - 0.5 * e})`;
      break;
    }
    case "card": // la siguiente sube como tarjeta y crece hasta llenar
      a.style.zIndex = "1";
      b.style.zIndex = "2";
      b.style.transform = `translate3d(0, ${(1 - e) * 100}%, 0) scale(${0.84 + 0.16 * e})`;
      b.style.borderRadius = `${(1 - e) * 48}px`;
      a.style.transform = `scale(${1 - 0.1 * e})`;
      a.style.filter = `brightness(${1 - 0.55 * e})`;
      break;
    case "wipe": // cortina que sube con parallax
      a.style.zIndex = "1";
      b.style.zIndex = "2";
      b.style.clipPath = `inset(${((1 - e) * 100).toFixed(2)}% 0 0 0)`;
      b.style.transform = `translate3d(0, ${(1 - e) * 12}%, 0)`;
      a.style.transform = `translate3d(0, ${-e * 30}%, 0)`;
      break;
    case "lift": // la que sale se levanta y deja el footer debajo
      a.style.zIndex = "2";
      b.style.zIndex = "1";
      a.style.transform = `translate3d(0, ${-e * 100}%, 0)`;
      a.style.borderRadius = `0 0 ${e * 60}px ${e * 60}px`;
      b.style.transform = `translate3d(0, ${(1 - e) * -25}%, 0) scale(${0.94 + 0.06 * e})`;
      break;
  }
}

export function startLandingMotion(root: HTMLElement, options: LandingMotionOptions): () => void {
  const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const qa = <T extends Element = HTMLElement>(selector: string) => Array.from(root.querySelectorAll<T>(selector));
  const cleanups: Array<() => void> = [];
  const on = <K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, passive = true) => {
    window.addEventListener(type, handler, { passive });
    cleanups.push(() => window.removeEventListener(type, handler));
  };

  const reduced = options.reducedMotion;
  root.classList.toggle("is-reduced", reduced);
  const timers: number[] = [];
  cleanups.push(() => timers.forEach((timer) => window.clearTimeout(timer)));
  /** Hace entrar las letras de un título y, al terminar, activa su flotación y hover. */
  const revealLine = (line: Element) => {
    if (line.classList.contains("acl-in")) return;
    line.classList.add("acl-in");
    const count = line.querySelectorAll(".acl-char").length;
    timers.push(window.setTimeout(() => line.classList.add("acl-alive"), 1300 + count * 26));
  };
  applyMedia(root, options.media);
  qa("[data-split]").forEach(splitLetters);

  // La landing controla el desplazamiento: se bloquea el scroll del documento.
  const html = document.documentElement;
  const previousOverflow = html.style.overflow;
  html.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  // ---------- Escenas y línea de tiempo ----------
  const scenes: Scene[] = qa<HTMLElement>("[data-scene]").map((el) => ({
    el,
    id: el.dataset["scene"] ?? "",
    len: Math.max(0.05, Number(el.dataset["len"] ?? 0.5)),
    out: (el.dataset["out"] as TransitionKind | undefined) ?? null,
    start: 0,
    holdEnd: 0,
    end: 0,
  }));
  let cursorPos = 0;
  scenes.forEach((scene, index) => {
    scene.start = cursorPos;
    scene.holdEnd = cursorPos + scene.len;
    scene.end = index < scenes.length - 1 ? scene.holdEnd + TRANSITION : scene.holdEnd;
    cursorPos = scene.end;
  });
  const total = cursorPos;
  const sceneById = (id: string) => scenes.find((scene) => scene.id === id);
  const localProgress = (id: string, v: number) => {
    const scene = sceneById(id);
    return scene ? seg(v, scene.start, scene.holdEnd) : 0;
  };

  let target = 0;
  let position = 0;
  let lastInput = 0;
  let direction = 1;
  let velocity = 0;
  let snapping = false;

  const goTo = (id: string) => {
    const scene = sceneById(id);
    if (!scene) return;
    target = scene.start;
    snapping = true;
    direction = target >= position ? 1 : -1;
    lastInput = performance.now();
  };
  const stepScene = (delta: number) => {
    let index = 0;
    scenes.forEach((scene, i) => {
      if (target >= scene.start - 0.001) index = i;
    });
    const here = scenes[index];
    if (!here) return;
    if (delta > 0) target = scenes[Math.min(scenes.length - 1, index + 1)]?.start ?? target;
    else target = target > here.start + 0.05 ? here.start : (scenes[Math.max(0, index - 1)]?.start ?? 0);
    snapping = true;
    direction = delta > 0 ? 1 : -1;
    lastInput = performance.now();
  };
  function currentIndex(v: number): number {
    let index = 0;
    scenes.forEach((scene, i) => {
      if (v >= scene.start - TRANSITION * 0.5) index = i;
    });
    return index;
  }
  const nudge = (deltaScreens: number) => {
    if (introActive || jumping) return;
    target = clamp(target + deltaScreens, 0, total);
    direction = deltaScreens >= 0 ? 1 : -1;
    lastInput = performance.now();
    snapping = false;
  };

  on(
    "wheel",
    (event) => {
      if ((event.target as Element | null)?.closest(".acl-plans") && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 36 : event.deltaMode === 2 ? window.innerHeight : 1;
      nudge((event.deltaY * unit) / window.innerHeight / 1.4);
    },
    false,
  );
  let touchY: number | null = null;
  on("touchstart", (event) => {
    touchY = event.touches[0]?.clientY ?? null;
  });
  on("touchmove", (event) => {
    const y = event.touches[0]?.clientY;
    if (touchY === null || y === undefined) return;
    nudge(((touchY - y) / window.innerHeight) * 1.5);
    touchY = y;
  });
  on("touchend", () => {
    touchY = null;
  });
  on("keydown", (event) => {
    const tag = (event.target as HTMLElement | null)?.tagName ?? "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (["ArrowDown", "PageDown"].includes(event.key) || (event.key === " " && !event.shiftKey)) {
      event.preventDefault();
      stepScene(1);
    } else if (["ArrowUp", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey)) {
      event.preventDefault();
      stepScene(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(scenes[0]?.id ?? "");
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(scenes[scenes.length - 1]?.id ?? "");
    }
  }, false);

  // Saltos desde el navbar / puntos: cada destino tiene su propia transición de pantalla completa
  const jumpEl = q(".acl-jump");
  const jumpLabel = jumpEl?.querySelector<HTMLElement>(".acl-jump-label b") ?? null;
  const jumpTiles = jumpEl ? Array.from(jumpEl.querySelectorAll<HTMLElement>(".acl-jump-grid i")) : [];
  const JUMPS: Record<string, { mode: string; label: string }> = {
    hero: { mode: "shutter", label: "Inicio" },
    problem: { mode: "diagonal", label: "El problema" },
    transform: { mode: "strips", label: "Cómo funciona" },
    features: { mode: "iris", label: "Funciones" },
    platforms: { mode: "diagonal", label: "Plataformas" },
    results: { mode: "blinds", label: "Resultados" },
    pricing: { mode: "tiles", label: "Precios" },
    cta: { mode: "iris", label: "Empezar" },
  };
  let jumping = false;
  const jump = (id: string, originX: number, originY: number) => {
    const scene = sceneById(id);
    const config = JUMPS[id];
    if (!scene || jumping || introActive) return;
    if (reduced || !jumpEl || !config || Math.abs(scene.start - position) < 0.02) {
      goTo(id);
      return;
    }
    jumping = true;
    jumpEl.dataset["mode"] = config.mode;
    if (jumpLabel) jumpLabel.textContent = config.label;
    jumpEl.style.setProperty("--ox", `${originX}px`);
    jumpEl.style.setProperty("--oy", `${originY}px`);
    // mosaico: cada cuadro entra según su distancia al clic
    jumpTiles.forEach((tile, index) => {
      const cx = ((index % 6) + 0.5) / 6 * window.innerWidth;
      const cy = (Math.floor(index / 6) + 0.5) / 4 * window.innerHeight;
      tile.style.setProperty("--d", String(Math.round(Math.hypot(cx - originX, cy - originY) / 4)));
    });
    jumpEl.classList.remove("is-out");
    jumpEl.classList.add("is-in");
    const coverTime = config.mode === "tiles" ? 900 : 760;
    timers.push(window.setTimeout(() => {
      target = position = lastPosition = scene.start;
      velocity = 0;
      snapping = false;
      lastInput = performance.now();
    }, coverTime - 60));
    timers.push(window.setTimeout(() => {
      jumpEl.classList.remove("is-in");
      jumpEl.classList.add("is-out");
    }, coverTime + 140));
    timers.push(window.setTimeout(() => {
      jumpEl.classList.remove("is-out");
      jumping = false;
    }, coverTime + 1000));
  };
  const onGoto = (event: Event) => {
    const link = (event.target as Element | null)?.closest<HTMLElement>("[data-goto]");
    if (!link) return;
    event.preventDefault();
    const pointer = event as MouseEvent;
    const rect = link.getBoundingClientRect();
    const x = pointer.clientX || rect.left + rect.width / 2;
    const y = pointer.clientY || rect.top + rect.height / 2;
    jump(link.dataset["goto"] ?? "", x, y);
  };
  root.addEventListener("click", onGoto);
  cleanups.push(() => root.removeEventListener("click", onGoto));
  // Un foco por teclado dentro de otra escena lleva a esa escena
  const onFocus = (event: FocusEvent) => {
    const scene = (event.target as Element | null)?.closest<HTMLElement>("[data-scene]");
    if (scene && event.target instanceof HTMLElement && event.target.matches(":focus-visible")) goTo(scene.dataset["scene"] ?? "");
  };
  root.addEventListener("focusin", onFocus);
  cleanups.push(() => root.removeEventListener("focusin", onFocus));
  // Al recargar siempre se empieza en el inicio: se quita cualquier #seccion de la URL
  // y se desactiva la restauración de scroll del navegador.
  const hashMap: Record<string, string> = { "#como-funciona": "transform", "#funciones": "features", "#resultados": "results", "#precios": "pricing" };
  const fromHash = hashMap[location.hash];
  if (fromHash) {
    const scene = sceneById(fromHash);
    if (scene) target = position = scene.start;
  }
  if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  // Nada puede desplazar las capas por dentro (scrollIntoView, foco, anclas).
  const lockScroll = (event: Event) => {
    const el = event.target;
    if (el instanceof HTMLElement && (el === root || el.matches("[data-scene], .acl-scenes")) && (el.scrollTop || el.scrollLeft)) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  };
  root.addEventListener("scroll", lockScroll, true);
  cleanups.push(() => root.removeEventListener("scroll", lockScroll, true));
  window.scrollTo(0, 0);

  // ---------- Elementos ----------
  const hint = q(".acl-hint");
  const dots = qa<HTMLElement>(".acl-dots [data-goto]");
  const navLinks = qa<HTMLElement>(".acl-links [data-goto]");
  const hero = q('[data-scene="hero"]');
  const heroTime = q(".acl-live-time");
  const problem = q('[data-scene="problem"]');
  const problemHours = q(".acl-problem-hours");
  const problemMinutes = q(".acl-problem-minutes");
  const hots = qa(".acl-hot");
  const steps = qa(".acl-step");
  const stepCopy = qa(".acl-step-copy span");
  const stage = q(".acl-stage");
  const frame = q(".acl-frame");
  const wave = q(".acl-wave");
  const marksBar = q(".acl-marks");
  const marks = qa(".acl-mark");
  const panel = q(".acl-panel");
  const pickLine = q(".acl-tr-pick");
  const captionWords = qa(".acl-caption span");
  // Estudio de funciones con un cursor que hace la demo
  const studio = q(".acl-studio");
  const demoCursor = q(".acl-demo-cursor");
  let studioFeature = 0;
  let studioStart = performance.now();
  let lastClickAt = -1;
  interface DemoStep { readonly sel: string | null; readonly at: number; readonly act?: "click" | "down" | "up" }
  // Guion de 6 s por función: a dónde va el cursor y qué hace al llegar
  const scripts: DemoStep[][] = [
    [{ sel: null, at: 0 }, { sel: ".acl-tl-sel i:last-child", at: 1.0, act: "down" }, { sel: ".acl-tl-sel i:last-child", at: 2.3, act: "up" }, { sel: ".b0", at: 3.1, act: "click" }, { sel: ".acl-versions .new", at: 4.4 }, { sel: null, at: 5.7 }],
    [{ sel: null, at: 0 }, { sel: ".l0", at: 1.0, act: "click" }, { sel: ".acl-sp-div", at: 2.4, act: "down" }, { sel: ".acl-sp-div", at: 3.6, act: "up" }, { sel: ".c1", at: 4.4, act: "click" }, { sel: null, at: 5.7 }],
    [{ sel: null, at: 0 }, { sel: ".b2", at: 0.9, act: "click" }, { sel: ".acl-lines li:nth-child(2)", at: 2.4 }, { sel: ".s2", at: 3.8, act: "click" }, { sel: ".acl-sp-cap", at: 4.8 }, { sel: null, at: 5.7 }],
    [{ sel: null, at: 0 }, { sel: ".acl-tl-pin.p0", at: 1.0 }, { sel: ".m1", at: 2.6 }, { sel: ".b3", at: 4.0, act: "click" }, { sel: ".acl-sp-stamp", at: 4.8 }, { sel: null, at: 5.7 }],
  ];
  const demoPoint = (sel: string | null): [number, number] => {
    if (!studio) return [0, 0];
    const box = studio.getBoundingClientRect();
    const target = sel ? studio.querySelector<HTMLElement>(`.acl-studio[data-f="${studioFeature}"] ${sel}, ${sel}`) : null;
    const visibleTarget = target && target.offsetParent !== null ? target : null;
    if (!visibleTarget) return [box.width * 0.42, box.height * 0.62];
    const rect = visibleTarget.getBoundingClientRect();
    return [rect.left - box.left + rect.width / 2, rect.top - box.top + rect.height / 2];
  };
  function renderDemoCursor(seconds: number) {
    if (!demoCursor) return;
    const t = seconds % 6;
    const steps = scripts[studioFeature] ?? [];
    let index = 0;
    while (index < steps.length - 1 && (steps[index + 1]?.at ?? 99) <= t) index++;
    const from = steps[index];
    const to = steps[index + 1];
    if (!from) return;
    const [ax, ay] = demoPoint(from.sel);
    let x = ax;
    let y = ay;
    if (to) {
      // viaja durante los últimos 0.7 s antes de llegar al siguiente paso
      const travel = easeInOut(seg(t, Math.max(from.at, to.at - 0.7), to.at));
      const [bx, by] = demoPoint(to.sel);
      x = lerp(ax, bx, travel);
      y = lerp(ay, by, travel) - Math.sin(Math.PI * travel) * 30;
    }
    demoCursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    const pressed = steps.some((step, i) => step.act === "down" && t >= step.at && t < (steps[i + 1]?.at ?? 6));
    demoCursor.classList.toggle("is-down", pressed);
    const clickStep = steps.findIndex((step) => (step.act === "click" || step.act === "down") && t >= step.at && t < step.at + 0.05);
    const clickId = clickStep >= 0 ? studioFeature * 10 + clickStep : -1;
    if (clickId >= 0 && clickId !== lastClickAt) {
      lastClickAt = clickId;
      demoCursor.classList.remove("is-click");
      void demoCursor.offsetWidth;
      demoCursor.classList.add("is-click");
    }
    if (t < 0.1) lastClickAt = -1;
  }
  const featureButtons = qa<HTMLButtonElement>("[data-feature]");
  featureButtons.forEach((button) => {
    const select = () => {
      const scene = sceneById("features");
      if (!scene) return;
      const index = Number(button.dataset["feature"] ?? 0);
      target = scene.start + (scene.len * index) / Math.max(1, featureButtons.length - 1);
      lastInput = performance.now();
      snapping = true;
      direction = target >= position ? 1 : -1;
    };
    button.addEventListener("click", select);
    cleanups.push(() => button.removeEventListener("click", select));
  });
  const marquees = qa(".acl-marquee").map((row) => ({
    track: row.querySelector<HTMLElement>(".acl-marquee-track"),
    dir: Number(row.dataset["dir"] ?? 1),
    x: 0,
  }));
  const columns = qa(".acl-col");
  const cta = q('[data-scene="cta"]');
  const magnet = q(".acl-magnet");
  const cursor = q(".acl-cursor");
  const cursorLabel = cursor?.querySelector("span") ?? null;

  // Palabras de la transcripción
  const allWords: HTMLElement[] = [];
  qa(".acl-tr").forEach((line) => {
    const stamp = line.querySelector(".acl-ts");
    const text = Array.from(line.childNodes).filter((node) => node !== stamp).map((node) => node.textContent ?? "").join("");
    line.textContent = "";
    if (stamp) line.appendChild(stamp);
    text.trim().split(/\s+/).forEach((word, index) => {
      if (index) line.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      span.className = "acl-word";
      span.textContent = word;
      line.appendChild(span);
      allWords.push(span);
    });
  });
  const makeBars = (container: HTMLElement | null, count: number) => {
    if (!container) return [] as HTMLElement[];
    container.textContent = "";
    return Array.from({ length: count }, () => container.appendChild(document.createElement("i")));
  };
  const waveBars = makeBars(q(".acl-wave"), 90);
  makeBars(q(".acl-tl-wave"), 80).forEach((bar, index) => {
    bar.style.height = `${18 + (Math.sin(index * 0.9) * 0.5 + 0.5) * (Math.sin(index * 0.23) * 0.5 + 0.5) * 82}%`;
  });
  const introBars = makeBars(q(".acl-intro-wave"), 70);

  // Precios: mensual / anual
  qa<HTMLButtonElement>("[data-billing]").forEach((button, _i, all) => {
    const select = () => {
      const mode = button.dataset["billing"] === "year" ? "year" : "month";
      all.forEach((other) => {
        other.classList.toggle("is-on", other === button);
        other.setAttribute("aria-pressed", String(other === button));
      });
      qa("[data-month]").forEach((price) => (price.textContent = price.dataset[mode] ?? price.textContent));
    };
    button.addEventListener("click", select);
    cleanups.push(() => button.removeEventListener("click", select));
  });

  // ---------- Puntero, cursor, clips y botón magnético ----------
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;
  let cursorX = pointerX;
  let cursorY = pointerY;
  let parallaxX = 0;
  let parallaxY = 0;
  on("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  });
  if (options.finePointer && !reduced && cursor) {
    root.classList.add("has-cursor");
    const over = (event: Event) => {
      const element = event.target as Element | null;
      const labelled = element?.closest<HTMLElement>("[data-cursor]");
      const link = element?.closest("a, button");
      cursor.classList.toggle("is-label", !!labelled);
      cursor.classList.toggle("is-link", !labelled && !!link);
      if (cursorLabel) cursorLabel.textContent = labelled?.dataset["cursor"] ?? "";
    };
    root.addEventListener("pointerover", over);
    cleanups.push(() => root.removeEventListener("pointerover", over));
  }
  // Inclinación 3D con reflejo en [data-tilt]
  if (options.finePointer && !reduced) {
    let tilted: HTMLElement | null = null;
    const release = () => {
      if (!tilted) return;
      tilted.classList.remove("is-tilting");
      tilted.style.setProperty("--rx", "0deg");
      tilted.style.setProperty("--ry", "0deg");
      tilted = null;
    };
    const tilt = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (element !== tilted) release();
      if (!element) return;
      tilted = element;
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      element.classList.add("is-tilting");
      element.style.setProperty("--ry", `${((x - 0.5) * 12).toFixed(2)}deg`);
      element.style.setProperty("--rx", `${((0.5 - y) * 10).toFixed(2)}deg`);
      element.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
      element.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
    };
    root.addEventListener("pointermove", tilt);
    root.addEventListener("pointerleave", release);
    cleanups.push(() => {
      root.removeEventListener("pointermove", tilt);
      root.removeEventListener("pointerleave", release);
    });
  }
  const spot = q(".acl-spot");

  qa(".acl-clip").forEach((clip) => {
    const video = clip.querySelector("video");
    if (!video) return;
    const enter = () => {
      if (video.src) void video.play().catch(() => undefined);
    };
    const leave = () => video.pause();
    clip.addEventListener("pointerenter", enter);
    clip.addEventListener("pointerleave", leave);
    cleanups.push(() => {
      clip.removeEventListener("pointerenter", enter);
      clip.removeEventListener("pointerleave", leave);
    });
  });
  if (magnet && cta && options.finePointer && !reduced) {
    const move = (event: PointerEvent) => {
      const rect = magnet.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const pull = Math.hypot(dx, dy) < rect.width * 1.2 ? 0.4 : 0;
      magnet.style.setProperty("--bx", `${dx * pull}px`);
      magnet.style.setProperty("--by", `${dy * pull}px`);
    };
    const reset = () => {
      magnet.style.setProperty("--bx", "0px");
      magnet.style.setProperty("--by", "0px");
    };
    cta.addEventListener("pointermove", move);
    cta.addEventListener("pointerleave", reset);
    cleanups.push(() => {
      cta.removeEventListener("pointermove", move);
      cta.removeEventListener("pointerleave", reset);
    });
  }

  // ---------- Intro ----------
  const intro = q(".acl-intro");
  let introActive = false;
  const revealHero = () => {
    root.classList.add("acl-in");
    qa('[data-scene="hero"] [data-split]').forEach(revealLine);
  };
  const finishIntro = () => {
    if (!intro || intro.hidden) return;
    introActive = false;
    intro.hidden = true;
    revealHero();
    options.onIntroDone?.();
  };
  if (intro && !options.skipIntro && !reduced && !fromHash) {
    introActive = true;
    intro.querySelector("button")?.addEventListener("click", finishIntro, { once: true });
  } else {
    intro?.setAttribute("hidden", "");
    revealHero();
  }
  const introStart = performance.now();
  const introFrame = intro?.querySelector<HTMLElement>(".acl-intro-frame") ?? null;
  const introTime = intro?.querySelector<HTMLElement>(".acl-intro-time") ?? null;
  const introWave = intro?.querySelector<HTMLElement>(".acl-intro-wave") ?? null;
  const introWord = intro?.querySelector<HTMLElement>(".acl-intro-word") ?? null;
  const introCuts = intro ? Array.from(intro.querySelectorAll<HTMLElement>(".acl-intro-cut")) : [];
  let holeStart: { left: number; top: number; width: number; height: number } | null = null;

  function renderIntro(seconds: number) {
    if (!intro || !introFrame) return;
    const appear = easeOut(seg(seconds, 0, 0.7));
    introFrame.style.opacity = String(appear);
    const read = seg(seconds, 0.4, 1.6);
    if (introTime) introTime.textContent = hms(easeInOut(read) * 3 * 3600);
    introWave?.style.setProperty("--head", `${read * 100}%`);
    introBars.forEach((bar, index) => {
      const amplitude = (Math.sin(index * 0.45 + seconds * 9) * 0.5 + 0.5) * (Math.sin(index * 0.13 - seconds * 3) * 0.5 + 0.5);
      bar.style.height = `${8 + amplitude * 46}px`;
      bar.style.background = index / introBars.length < read ? "#4d7dff" : "#2a2e3d";
    });
    const cutDrop = easeOut(seg(seconds, 1.5, 1.9));
    const cutWidth = (9 / 16) * (9 / 16) * 100; // ancho de un 9:16 dentro de un 16:9, en %
    const side = (100 - cutWidth) / 2;
    introCuts.forEach((cut, index) => {
      cut.style.transform = `scaleY(${cutDrop})`;
      cut.style.left = index ? `calc(${100 - side}% - 1.5px)` : `calc(${side}% - 1.5px)`;
      cut.style.opacity = String(1 - seg(seconds, 2.3, 2.5));
    });
    const crop = easeInOut(seg(seconds, 1.9, 2.4));
    if (introWave) introWave.style.opacity = String(1 - crop);
    if (introWord) {
      introWord.style.opacity = String(seg(seconds, 1.95, 2.25) * (1 - seg(seconds, 2.5, 2.7)));
      introWord.style.transform = `translateY(${(1 - easeOut(seg(seconds, 1.95, 2.6))) * 20}px)`;
    }
    const sideInset = side * crop;
    introFrame.style.clipPath = `inset(0 ${sideInset}% 0 ${sideInset}% round 18px)`;
    introFrame.style.transform = `scale(${lerp(0.94, 1, appear)})`;
    const open = easeInOut(seg(seconds, 2.45, 3.15));
    if (open > 0) {
      // Se abre un "agujero" vertical que crece hasta la pantalla completa y deja ver el hero.
      if (!holeStart) {
        const rect = introFrame.getBoundingClientRect();
        const inset = (rect.width * sideInset) / 100;
        holeStart = { left: rect.left + inset, top: rect.top, width: rect.width - inset * 2, height: rect.height };
      }
      const left = lerp(holeStart.left, 0, open);
      const top = lerp(holeStart.top, 0, open);
      const width = lerp(holeStart.width, window.innerWidth, open);
      const height = lerp(holeStart.height, window.innerHeight, open);
      const full = "linear-gradient(#000 0 0) 0 0 / 100% 100% no-repeat";
      const hole = `linear-gradient(#000 0 0) ${left}px ${top}px / ${width}px ${height}px no-repeat`;
      intro.style.setProperty("-webkit-mask", `${full}, ${hole}`);
      intro.style.setProperty("-webkit-mask-composite", "xor");
      intro.style.setProperty("mask", `${full}, ${hole}`);
      intro.style.setProperty("mask-composite", "exclude");
      introFrame.style.opacity = String(1 - seg(seconds, 2.45, 2.8));
    }
    if (seconds > 2.7 && !root.classList.contains("acl-in")) revealHero();
    if (seconds >= 3.2) finishIntro();
  }

  // ---------- Reproducción automática ----------
  const AUTOPLAY_SECONDS: Record<string, number> = { problem: 5, transform: 13 };
  const FEATURE_SECONDS = 6; // un ciclo completo de cada demo
  let holdReachedAt = 0;
  function autoplay(now: number, dt: number) {
    const scene = scenes.find((s) => target >= s.start - 0.0005 && target <= s.holdEnd + 0.0005);
    if (!scene) return;
    if (scene.id === "features") {
      const count = featureButtons.length;
      if (count < 2 || Math.abs(target - position) > 0.01 || now - studioStart < FEATURE_SECONDS * 1000) return;
      const next = (studioFeature + 1) % count;
      target = scene.start + (scene.len * next) / (count - 1);
      if (next === 0) position = lastPosition = target; // vuelve a la primera sin rebobinar
      snapping = true;
      return;
    }
    const seconds = AUTOPLAY_SECONDS[scene.id];
    if (!seconds) return;
    if (target < scene.holdEnd - 0.0005) {
      target = Math.min(scene.holdEnd, target + (scene.len / seconds) * dt);
      holdReachedAt = 0;
      return;
    }
    // "Cómo funciona" se repite tras una pausa al terminar; "El problema" se queda completo
    if (scene.id !== "transform") return;
    if (!holdReachedAt) holdReachedAt = now;
    if (now - holdReachedAt > 2600) {
      holdReachedAt = 0;
      target = position = lastPosition = scene.start;
      scene.el.animate([{ opacity: 0.4, filter: "brightness(1.6)" }, { opacity: 1, filter: "none" }], { duration: 600, easing: "ease-out" });
    }
  }

  // ---------- Bucle principal ----------
  const heroStart = performance.now();
  let lastTime = performance.now();
  let frameId = 0;
  let lastPosition = position;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (introActive) renderIntro((now - introStart) / 1000);

    // Autocompletar transiciones cuando el usuario suelta
    if (!snapping && now - lastInput > 170) {
      const scene = scenes.find((s) => target > s.holdEnd + 0.001 && target < s.end - 0.001);
      if (scene) {
        const t = (target - scene.holdEnd) / TRANSITION;
        target = direction > 0 ? (t > 0.12 ? scene.end : scene.holdEnd) : t < 0.88 ? scene.holdEnd : scene.end;
        snapping = true;
      }
    }
    // Reproducción automática: si no tocas nada, las secciones con recorrido interno avanzan solas
    if (!reduced && !introActive && !jumping && now - lastInput > 1600) autoplay(now, dt);

    const ease = snapping ? 0.085 : 0.12;
    position = reduced ? target : lerp(position, target, 1 - Math.pow(1 - ease, dt * 60));
    if (Math.abs(target - position) < 0.0005) position = target;
    velocity = lerp(velocity, (position - lastPosition) / Math.max(dt, 0.001), 0.15);
    lastPosition = position;
    const v = position;

    // Capas: quién se ve y cómo
    scenes.forEach((scene) => resetLayer(scene.el));
    scenes.forEach((scene, index) => {
      const prev = scenes[index - 1];
      const visible = (prev ? v > prev.holdEnd + 0.0005 : true) && v <= scene.end - (scenes[index + 1] ? 0.0005 : -1);
      scene.el.classList.toggle("is-visible", visible);
    });
    scenes.forEach((scene, index) => {
      const next = scenes[index + 1];
      if (!next || !scene.out) return;
      const t = seg(v, scene.holdEnd, scene.end);
      if (t > 0 && t < 1) applyTransition(scene.out, scene.el, next.el, t, reduced);
    });

    // Títulos de otras escenas: entran al hacerse visibles
    scenes.forEach((scene) => {
      if (scene.id !== "hero" && scene.id !== "problem" && v > scene.start - TRANSITION * 0.45) scene.el.querySelectorAll("[data-split]").forEach(revealLine);
    });

    // Navegación
    const active = currentIndex(v);
    dots.forEach((dot) => dot.classList.toggle("is-on", dot.dataset["goto"] === scenes[active]?.id));
    navLinks.forEach((link) => link.classList.toggle("is-current", link.dataset["goto"] === scenes[active]?.id));
    hint?.classList.toggle("is-gone", v > 0.05 || introActive);

    // Hero: parallax por puntero y zoom de entrada
    if (hero && !reduced) {
      parallaxX = lerp(parallaxX, pointerX / window.innerWidth - 0.5, 0.06);
      parallaxY = lerp(parallaxY, pointerY / window.innerHeight - 0.5, 0.06);
      hero.style.setProperty("--mx", parallaxX.toFixed(4));
      hero.style.setProperty("--my", parallaxY.toFixed(4));
      const zoom = lerp(1.22, 1.06, easeOut(seg((now - heroStart) / 1000, introActive ? 2.6 : 0, introActive ? 5.5 : 2.8)));
      hero.style.setProperty("--hz", zoom.toFixed(4));
    }
    if (heroTime) heroTime.textContent = `EN VIVO ${hms(9677 + (now - heroStart) / 1000)}`;

    // Problema
    const problemScene = sceneById("problem");
    if (problem && problemScene && v > problemScene.start - TRANSITION * 0.6) {
      problem.querySelectorAll("[data-split]").forEach(revealLine);
      const t = easeInOut(seg(localProgress("problem", v), 0.05, 0.95));
      problem.style.setProperty("--p", t.toFixed(4));
      if (problemHours) problemHours.textContent = hms(t * 3 * 3600);
      let minutes = 0;
      hots.forEach((hot) => {
        const isOn = t >= parseFloat(hot.style.getPropertyValue("--x")) / 100;
        hot.classList.toggle("is-on", isOn);
        if (isOn) minutes += 9;
      });
      if (problemMinutes) problemMinutes.textContent = `${minutes} min`;
    }

    // Transformación
    if (stage && frame) {
      const p = localProgress("transform", v);
      const phases = [0, 0.18, 0.42, 0.6, 0.86];
      steps.forEach((step, index) => {
        step.style.setProperty("--sp", seg(p, phases[index] ?? 0, phases[index + 1] ?? 1).toFixed(3));
        step.classList.toggle("is-on", p >= (phases[index] ?? 0));
      });
      const activeStep = p < (phases[1] ?? 0) ? 0 : p < (phases[2] ?? 0) ? 1 : p < (phases[3] ?? 0) ? 2 : 3;
      stepCopy.forEach((copy, index) => copy.classList.toggle("is-on", index === activeStep));
      const r = easeInOut(seg(p, 0.6, 0.74));
      const sw = stage.clientWidth;
      const sh = stage.clientHeight - 90;
      const w0 = Math.min(sw, (sh * 0.92 * 16) / 9);
      const h0 = (w0 * 9) / 16;
      const h1 = Math.min(sh * 1.05, (sw * 16) / 9);
      const w1 = (h1 * 9) / 16;
      frame.style.width = `${lerp(w0, w1, r)}px`;
      frame.style.height = `${lerp(h0, h1, r)}px`;
      frame.style.top = `${lerp(sh * 0.5, (sh + 90) * 0.5, r)}px`;
      frame.style.setProperty("--cap", `${lerp(h0 * 0.07, h1 * 0.062, r)}px`);
      const audio = 1 - seg(p, 0.58, 0.62);
      if (wave) wave.style.opacity = String(audio);
      if (marksBar) marksBar.style.opacity = String(audio);
      const read = seg(p, phases[1] ?? 0, phases[2] ?? 1);
      waveBars.forEach((bar, index) => {
        const amplitude = (Math.sin(index * 0.37 + now / 170) * 0.5 + 0.5) * (Math.sin(index * 0.11 - now / 430) * 0.5 + 0.5);
        bar.style.height = `${8 + amplitude * 92}%`;
        bar.classList.toggle("is-read", index / waveBars.length < read);
      });
      marks.forEach((mark, index) => mark.classList.toggle("is-on", p > (phases[2] ?? 0) + 0.03 + index * 0.045));
      panel?.classList.toggle("is-on", p > (phases[1] ?? 0) - 0.04);
      const shown = Math.floor(seg(p, phases[1] ?? 0, (phases[2] ?? 0) - 0.02) * allWords.length);
      allWords.forEach((word, index) => word.classList.toggle("is-on", index < shown));
      pickLine?.classList.toggle("is-picked", p > (phases[2] ?? 0) + 0.04);
      panel?.classList.toggle("is-done", p > 0.9);
      captionWords.forEach((word, index) => {
        const start = 0.75 + index * 0.025;
        word.classList.toggle("is-on", p > start);
        word.classList.toggle("is-hl", p > start && p < start + 0.025);
      });
    }

    // Funciones: cada tarjeta sube y tapa a la anterior
    {
      const k = localProgress("features", v) * Math.max(0, featureButtons.length - 1);
      const f = clamp(Math.round(k), 0, Math.max(0, featureButtons.length - 1));
      if (studio && f !== studioFeature) {
        studioFeature = f;
        studio.dataset["f"] = String(f);
        studioStart = now;
        studio.classList.remove("is-swap");
        void studio.offsetWidth;
        studio.classList.add("is-swap");
      }
      if (studio && demoCursor) renderDemoCursor((now - studioStart) / 1000);
      featureButtons.forEach((button, index) => {
        button.style.setProperty("--fp", clamp(k - index + 1).toFixed(3));
        button.classList.toggle("is-on", Math.round(k) === index);
      });
    }

    // Plataformas: marquee que acelera con la velocidad
    const speed = reduced ? 0 : 70 + Math.min(1800, Math.abs(velocity) * window.innerHeight * 0.6);
    const skew = reduced ? 0 : clamp(velocity * 4, -8, 8);
    marquees.forEach((row) => {
      if (!row.track) return;
      const half = row.track.scrollWidth / 2;
      row.x = (row.x - row.dir * speed * dt) % half;
      if (row.x > 0) row.x -= half;
      row.track.style.setProperty("--mq", `${row.x.toFixed(1)}px`);
      row.track.style.setProperty("--sk", `${(-row.dir * skew).toFixed(2)}deg`);
    });

    // Resultados: columnas a distinta velocidad
    if (!reduced) {
      const resultsScene = sceneById("results");
      const p = resultsScene ? seg(v, resultsScene.start - TRANSITION, resultsScene.end) : 0;
      columns.forEach((column) => {
        const factor = parseFloat(column.style.getPropertyValue("--s")) || 1;
        const drift = Math.sin(now / 2200 + factor * 4) * 26;
        column.style.setProperty("--cy", `${((0.35 - p) * 520 * factor + drift).toFixed(1)}px`);
      });
    }

    // CTA se ilumina al llegar
    const ctaScene = sceneById("cta");
    if (cta && ctaScene) cta.classList.toggle("is-lit", v > ctaScene.start - TRANSITION * 0.25);

    // Cursor
    if (cursor && root.classList.contains("has-cursor")) {
      cursorX = lerp(cursorX, pointerX, 0.25);
      cursorY = lerp(cursorY, pointerY, 0.25);
      cursor.style.transform = `translate3d(${cursorX.toFixed(1)}px, ${cursorY.toFixed(1)}px, 0)`;
      spot?.style.setProperty("--sx", `${cursorX.toFixed(0)}px`);
      spot?.style.setProperty("--sy", `${cursorY.toFixed(0)}px`);
    }

    if (Math.abs(target - position) < 0.0005) snapping = false;
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frameId);
    cleanups.forEach((cleanup) => cleanup());
    html.style.overflow = previousOverflow;
    document.body.style.overflow = "";
  };
}
