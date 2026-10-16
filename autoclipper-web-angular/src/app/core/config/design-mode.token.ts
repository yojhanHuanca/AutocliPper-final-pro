import { InjectionToken } from "@angular/core";
export const DESIGN_MODE = new InjectionToken<boolean>("DESIGN_MODE", {
  providedIn: "root",
  factory: () => false,
});
