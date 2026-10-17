import { Component } from '@angular/core';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';

@Component({
  selector: 'ac-hero-depth',
  imports: [IconComponent],
  templateUrl: './hero-depth.component.html',
  styleUrl: './hero-depth.component.css',
})
export class HeroDepthComponent {
  readonly wave = [34, 61, 45, 76, 52, 88, 38, 70, 47, 94, 63, 40, 83, 54, 72, 35, 65, 49];
  readonly clips = [
    { title: 'La frase que conecta.', time: '00:18 – 00:42', position: '34%' },
    { title: 'Una idea vale un clip.', time: '01:05 – 01:29', position: '51%' },
    { title: 'Cuéntalo a tu manera.', time: '02:11 – 02:35', position: '68%' },
  ];
}
