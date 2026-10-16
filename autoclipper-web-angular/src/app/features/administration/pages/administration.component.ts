import { ViewEncapsulation, Component } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IconComponent } from "../../../shared/ui/icon/icon.component";

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: "ac-admin",
  imports: [RouterLink, IconComponent],
  templateUrl: "./administration.component.html",
  styleUrl: "./administration.component.css",
})
export class AdminComponent {
  readonly groups = [
    {
      category: "01 / GENERAL",
      title: "Personas y espacios.",
      icon: "users",
      description:
        "Gestionar el acceso sin exponer contenido privado por defecto.",
      modules: ["Usuarios", "Equipos"],
    },
    {
      category: "02 / OPERACIÓN",
      title: "El trabajo en marcha.",
      icon: "film",
      description:
        "Conocer los estados y atender las incidencias con contexto.",
      modules: [
        "Procesamiento",
        "IA y modelos",
        "Publicaciones",
        "Integraciones",
      ],
    },
    {
      category: "03 / NEGOCIO",
      title: "Consumo con claridad.",
      icon: "chart",
      description:
        "Distinguir el consumo técnico de los futuros acuerdos comerciales.",
      modules: ["Planes y cuotas", "Facturación", "Consumo y costos"],
    },
    {
      category: "04 / CONFIANZA",
      title: "Cuidar cada historia.",
      icon: "shield",
      description:
        "Acciones sensibles con permisos específicos y trazabilidad.",
      modules: ["Soporte", "Privacidad y datos", "Seguridad", "Auditoría"],
    },
    {
      category: "05 / SISTEMA",
      title: "Una base confiable.",
      icon: "settings",
      description:
        "Estado operativo y políticas que se puedan revisar y verificar.",
      modules: ["Servicios y respaldos", "Contenido público", "Configuración"],
    },
  ];
}
