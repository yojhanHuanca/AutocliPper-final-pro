import { BrandComponent } from '../../shared/ui/brand/brand.component';
import { Component, ViewEncapsulation } from "@angular/core";
import { RouterLink, RouterOutlet } from "@angular/router";
import { IconComponent } from "../../shared/ui/icon/icon.component";
@Component({
  selector: "ac-administration-layout",
  imports: [BrandComponent, RouterLink, RouterOutlet, IconComponent],
  templateUrl: "./administration-layout.component.html",
  styleUrl: "./administration-layout.component.css",
  encapsulation: ViewEncapsulation.None,
})
export class AdministrationLayoutComponent {}
