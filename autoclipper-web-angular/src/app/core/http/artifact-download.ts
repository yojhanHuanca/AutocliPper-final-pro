export async function fetchPrivateArtifact(value: string): Promise<Blob> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('El servidor devolvió una URL de descarga inválida.');
  let response: Response;
  try { response = await fetch(url.href, { credentials: 'omit', redirect: 'error' }); }
  catch { throw new Error('No pudimos descargar el archivo. Vuelve a solicitar el enlace e inténtalo de nuevo.'); }
  if (!response.ok) throw new Error('El enlace de descarga no está disponible o venció. Solicita uno nuevo con el botón de descarga.');
  return response.blob();
}

export async function downloadPrivateArtifact(url: string, filename: string): Promise<void> {
  const blobUrl = URL.createObjectURL(await fetchPrivateArtifact(url));
  const link = document.createElement('a');
  link.href = blobUrl; link.download = filename; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
