// Read-only visual inspection of the previous promo. All build output stays in this frontend's ignored .local directory.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const legacy =
  "C:/estudio/4_ciclo/proyecto/2026-1-4c24-pi-3b/AutoClipper/user/frontend-react";
const out = path.resolve(
  fileURLToPath(new URL("../.local/legacy-preview/", import.meta.url)),
);
await mkdir(out, { recursive: true });
await build({
  stdin: {
    contents: `import React from '${legacy}/node_modules/react/index.js'; import {createRoot} from '${legacy}/node_modules/react-dom/client.js'; import Promo from '${legacy}/src/components/AutoClipperPromo.jsx'; createRoot(document.getElementById('promo')).render(<Promo/>);`,
    loader: "jsx",
    resolveDir: legacy,
  },
  bundle: true,
  outfile: path.join(out, "promo.js"),
  jsx: "automatic",
  loader: { ".png": "file" },
  assetNames: "assets/[name]-[hash]",
  logLevel: "warning",
});
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoClipper · referencia anterior</title><link rel="stylesheet" href="/promo.css"><style>*{box-sizing:border-box}body{margin:0;background:#fff;font:15px system-ui;color:#222;display:grid;justify-items:center;gap:24px;padding:30px}header{max-width:700px}#promo{width:500px;max-width:100%}h1{font-size:24px}p{line-height:1.6}</style><header><h1>Referencia anterior · AutoClipperPromo</h1><p>Componente original ejecutado desde sus archivos en solo lectura. Su diseño y sus cifras son históricos e ilustrativos: no acreditan capacidades del backend actual.</p></header><div id="promo"></div><script type="module" src="/promo.js"></script></html>`,
);
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
};
createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const target = path.resolve(
      out,
      "." + (relative === "/" ? "/index.html" : relative),
    );
    if (!target.startsWith(out + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    response
      .writeHead(200, {
        "Content-Type":
          types[path.extname(target)] ?? "application/octet-stream",
      })
      .end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
}).listen(4179, "localhost", () =>
  console.log("Legacy read-only preview: http://localhost:4179"),
);
