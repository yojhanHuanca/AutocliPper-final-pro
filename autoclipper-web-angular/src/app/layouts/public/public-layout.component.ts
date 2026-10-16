import { BrandComponent } from '../../shared/ui/brand/brand.component';
import { Component, ViewEncapsulation } from "@angular/core";
import { RouterLink, RouterOutlet } from "@angular/router";
import { IconComponent } from "../../shared/ui/icon/icon.component";
@Component({
  selector: "ac-public-layout",
  imports: [BrandComponent, RouterLink, RouterOutlet, IconComponent],
  templateUrl: "./public-layout.component.html",
  styleUrl: "./public-layout.component.css",
  encapsulation: ViewEncapsulation.None,
})
export class PublicLayoutComponent {}
