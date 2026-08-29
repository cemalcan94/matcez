// Forma SVG bileşeni — gövde: color, kollar: color2.
export function jersey(team, size = 40) {
  const c1 = team?.color ?? '#9aa192';
  const c2 = team?.color2 ?? '#ffffff';
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20 8 C24 13 40 13 44 8 L56 18 L50 31 L44 27 L44 56 L20 56 L20 27 L14 31 L8 18 Z"
      fill="${c1}" stroke="rgba(0,0,0,.22)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M8 18 L20 8 L20 27 L14 31 Z" fill="${c2}" stroke="rgba(0,0,0,.22)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M56 18 L44 8 L44 27 L50 31 Z" fill="${c2}" stroke="rgba(0,0,0,.22)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M24 8.8 C27 12 37 12 40 8.8" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;
}

// Satır içi küçük forma (takım adlarının yanında)
export function jerseyInline(team, size = 16) {
  return `<span class="jr" style="width:${size}px;height:${size}px">${jersey(team, size)}</span>`;
}
