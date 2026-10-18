export function changesPage(previous: string, next: string): boolean {
  return !next.includes("#") && previous.split(/[?#]/)[0] !== next.split(/[?#]/)[0];
}

export function focusMain(document: Pick<Document, "getElementById">, scroll = false): void {
  const main = document.getElementById("main");
  if (!main) return;
  main.tabIndex = -1;
  main.focus({ preventScroll: true });
  if (scroll) main.scrollIntoView({ block: "start", behavior: "instant" });
}

export function containTab(event: KeyboardEvent, container: HTMLElement, active: Element | null): void {
  if (event.key !== "Tab") return;
  const targets = Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(target => target.getClientRects().length > 0);
  const first = targets[0];
  const last = targets.at(-1);
  if (!first || !last) { event.preventDefault(); container.focus(); return; }
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault(); first.focus();
  }
}
