/** Syntax feedback only: this never establishes provider support or fetch safety. */
export function sourceLinkFeedback(value: string): { valid: boolean; message: string } {
  const text = value.trim();
  if (!text) return { valid: false, message: '' };
  if (text.length > 2048) return { valid: false, message: 'El enlace es demasiado largo (máximo 2048 caracteres).' };
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password)
      return { valid: false, message: 'Usa un enlace completo http o https, sin credenciales.' };
    return { valid: true, message: 'El formato del enlace es válido. La importación todavía no está disponible.' };
  } catch {
    return { valid: false, message: 'Incluye el enlace completo, empezando por https://.' };
  }
}

export type SourcePlatform = 'YouTube' | 'Kick' | 'Twitch';
export type PreviewTarget = { platform: SourcePlatform; kind: 'video' | 'clip' | 'live'; id: string };
export type SourceLinkResult = { state: 'empty' | 'invalid' | 'unsupported' | 'unverifiable' | 'preview'; title: string; message: string; platform?: SourcePlatform; target?: PreviewTarget };
const youtubeId = /^[A-Za-z0-9_-]{11}$/;
const clipId = /^[A-Za-z0-9_-]{1,100}$/;
const channelId = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,39}$/;

/** Closed host/path allowlist. Recognition never proves existence or importability. */
export function recognizeSourceLink(value: string): SourceLinkResult {
  if (!value.trim()) return {state:'empty', title:'Pega un enlace para empezar.', message:'Usa el enlace de un video de YouTube, Kick o Twitch.'};
  if (!sourceLinkFeedback(value).valid || /[\u0000-\u0020\\]/.test(value.trim())) return {state:'invalid', title:'Revisa el formato del enlace.', message:'Usa una URL completa https, sin espacios ni credenciales.'};
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.port) return {state:'invalid', title:'Usa un enlace https.', message:'No se admiten puertos personalizados ni conexiones http para la vista previa.'};
  const host = url.hostname, path = url.pathname.replace(/\/$/, '');
  let platform: SourcePlatform;
  let target: PreviewTarget | undefined;
  if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'].includes(host)) {
    platform = 'YouTube';
    const id = host.endsWith('youtu.be') ? /^\/([^/]+)$/.exec(path)?.[1] : path === '/watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)$/.exec(path)?.[1];
    if (id && youtubeId.test(id)) target = {platform, kind:'video', id};
  } else if (['twitch.tv','www.twitch.tv','m.twitch.tv','clips.twitch.tv'].includes(host)) {
    platform = 'Twitch';
    const video = /^\/videos\/([0-9]{1,20})$/.exec(path)?.[1];
    const clip = host === 'clips.twitch.tv' ? /^\/([A-Za-z0-9_-]+)$/.exec(path)?.[1] : /^\/[A-Za-z0-9_]+\/clip\/([A-Za-z0-9_-]+)$/.exec(path)?.[1];
    if (host !== 'clips.twitch.tv' && video) target = {platform,kind:'video',id:video};
    else if (clip && clipId.test(clip) && clip !== 'embed') target = {platform,kind:'clip',id:clip};
  } else if (['kick.com','www.kick.com'].includes(host)) {
    platform = 'Kick';
    // Official documentation describes channel/live embeds only. Never replace a replay with a live channel.
    const channel = /^\/([^/]+)$/.exec(path)?.[1];
    const reserved = ['video','videos','clips','categories','browse','search','settings','dashboard','login','register','following','subscriptions'];
    if (channel && channelId.test(channel) && !reserved.includes(channel.toLowerCase()) && !url.search) target = {platform,kind:'live',id:channel};
  } else return {state:'unsupported', title:'Esta plataforma no está contemplada.', message:'Utiliza un enlace de YouTube, Kick o Twitch. No cargamos reproductores de otros dominios.'};
  if (!target) return {state:'unverifiable', platform, title:`${platform} reconocido; video no verificable.`, message:platform === 'Kick' ? 'Kick solo permite aquí la vista previa oficial de un canal en directo. Este enlace no se convierte en ese canal y los VOD/clips no se importan. Puedes subir un archivo local.' : 'No reconocemos un video o clip concreto. Copia el enlace desde la página del video; un canal o colección no identifica un video.'};
  return {state:'preview', platform, target, title:'Enlace válido para solicitar vista previa.', message:target.kind === 'live' ? 'Es un canal en directo de Kick, no una grabación. Su disponibilidad se comprueba en el reproductor de la plataforma.' : 'Reconocimos la plataforma y el formato. La existencia, los permisos y la reproducción del video todavía no están verificados.'};
}

/** Constructs only official embed origins, never the pasted URL. */
export function officialSourcePreview(target: PreviewTarget, parent: string): string | null {
  if (target.platform === 'YouTube' && target.kind === 'video' && youtubeId.test(target.id)) return `https://www.youtube-nocookie.com/embed/${target.id}?autoplay=0`;
  if (target.platform === 'Kick' && target.kind === 'live' && channelId.test(target.id)) return `https://player.kick.com/${target.id}?autoplay=false`;
  if (target.platform === 'Twitch' && /^[a-z0-9.-]+$/i.test(parent)) {
    if (target.kind === 'video' && /^[0-9]{1,20}$/.test(target.id)) return `https://player.twitch.tv/?video=v${target.id}&parent=${encodeURIComponent(parent)}&autoplay=false`;
    if (target.kind === 'clip' && clipId.test(target.id)) return `https://clips.twitch.tv/embed?clip=${target.id}&parent=${encodeURIComponent(parent)}&autoplay=false`;
  }
  return null;
}
