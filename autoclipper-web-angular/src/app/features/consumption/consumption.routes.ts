import { Routes } from "@angular/router";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/consumption.component").then(
        (m) => m.ConsumptionComponent,
      ),
  },
];
