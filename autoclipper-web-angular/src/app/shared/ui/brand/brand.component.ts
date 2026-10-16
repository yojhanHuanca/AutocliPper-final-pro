import { Component, input } from '@angular/core';
@Component({
  selector: 'ac-brand',
  templateUrl: './brand.component.html',
  styleUrl: './brand.component.css',
  host: { '[class.full]': 'variant() === "full"' },
})
export class BrandComponent { readonly variant = input<'compact' | 'full'>('compact'); }
