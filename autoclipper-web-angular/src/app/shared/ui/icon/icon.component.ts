import { Component, input } from "@angular/core";

@Component({
  selector: "ac-icon",
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="paths[name()] || paths['grid']" />
  </svg>`,
})
export class IconComponent {
  readonly name = input("grid");
  readonly paths: Record<string, string> = {
    scissors:
      "M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M8.5 7.5 21 21 M8.5 16.5 21 3 M12 12h.01",
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    folder: "M3 7V4h6l2 3h10v13H3z",
    play: "M8 4v16l13-8z",
    film: "M3 3h18v18H3z M7 3v18 M17 3v18 M3 8h4 M3 16h4 M17 8h4 M17 16h4",
    chart: "M4 20V10 M10 20V4 M16 20v-8 M22 20H2",
    settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    arrow: "M4 12h16 M14 6l6 6-6 6",
    plus: "M12 4v16 M4 12h16",
    upload: "M12 16V3 M7 8l5-5 5 5 M3 16v5h18v-5",
    check: "M4 12l5 5L20 6",
    clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M12 6v6l4 2",
    shield: "M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6",
    users:
      "M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 16a5 5 0 0 1 3 5",
    download: "M12 3v13 M7 11l5 5 5-5 M3 17v4h18v-4",
    menu: "M3 6h18 M3 12h18 M3 18h18",
    search: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M15 15l6 6",
    logout: "M9 3H3v18h6 M8 12h13 M16 7l5 5-5 5",
    captions: "M2 5h20v14H2z M10 9H6v6h4 M18 9h-4v6h4",
    mail: "M2 5h20v14H2z M2 5l10 8L22 5",
    link: "M9 15l6-6 M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
    heart: "M12 21 3 12a5 5 0 0 1 9-6a5 5 0 0 1 9 6z",
  };
}
