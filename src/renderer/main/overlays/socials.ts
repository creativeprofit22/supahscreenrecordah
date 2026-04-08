// Social icons overlay — builds DOM and positions below camera

import { cameraSocials, cameraContainer, previewContainer } from '../dom';
import { currentLayout, activeAspectRatio } from '../state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SocialEntry {
  platform: string;
  username: string;
}

// ---------------------------------------------------------------------------
// SVG paths for social icons (24×24 viewBox)
// ---------------------------------------------------------------------------
export const SOCIAL_SVG_PATHS: Record<string, string> = {
  x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12z',
  tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  instagram: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.668 1.0745-1.3367 1.3802-2.1272.2957-.7637.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6794-.8186-.8964-1.3794-.1636-.4233-.3586-1.0584-.4114-2.2293-.0567-1.2671-.0689-1.6479-.0726-4.8566-.0036-3.2079.008-3.5882.0608-4.8568.0503-1.1707.2456-1.8057.408-2.2282.2166-.5613.4772-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.8988.4224-.1635 1.0576-.3588 2.2288-.4116 1.2672-.0567 1.6479-.0689 4.8564-.0726 3.2085-.0036 3.5884.0084 4.8574.0612 1.1703.0508 1.8053.2463 2.2282.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.8962 1.3783.1634.4232.3584 1.0578.4114 2.2296.0568 1.2673.069 1.6477.0726 4.8565.0037 3.2088-.0083 3.5882-.0612 4.8576-.0507 1.1706-.2455 1.8057-.4076 2.2282-.2164.5606-.4772.96-.8948 1.3818-.4194.4218-.8176.6812-1.3788.8968-.4228.1633-1.058.3588-2.229.4114-1.2676.0567-1.6477.069-4.857.0726-3.2093.0037-3.5882-.0083-4.8572-.0607M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
};

// ---------------------------------------------------------------------------
// Path2D cache — avoids re-parsing SVG paths every frame
// ---------------------------------------------------------------------------
const socialPath2DCache = new Map<string, Path2D>();

export function getSocialPath2D(platform: string): Path2D {
  let p = socialPath2DCache.get(platform);
  if (!p) {
    p = new Path2D(SOCIAL_SVG_PATHS[platform]);
    socialPath2DCache.set(platform, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let activeSocials: SocialEntry[] = [];

/** Get the currently active socials list (for recording pipeline, etc.). */
export function getActiveSocials(): SocialEntry[] {
  return activeSocials;
}

// ---------------------------------------------------------------------------
// Build & update
// ---------------------------------------------------------------------------

export function buildSocialsDOM(socials: Record<string, string>): void {
  const platforms = Object.keys(socials);
  activeSocials = platforms
    .filter((p) => socials[p].length > 0)
    .map((p) => ({ platform: p, username: socials[p] }));
  cameraSocials.innerHTML = '';
  for (let i = 0; i < activeSocials.length; i++) {
    const social = activeSocials[i];
    if (!social) {
      continue;
    }
    const { platform, username } = social;
    // Add dot separator between items (but not before a new row)
    // Layout: 2 per row, so dot between index 0–1, 2–3, etc.
    if (i > 0 && i % 2 !== 0) {
      const dot = document.createElement('span');
      dot.className = 'social-dot';
      dot.textContent = '•';
      cameraSocials.appendChild(dot);
    }
    // Force new row after every 2 items by inserting a line break
    if (i > 0 && i % 2 === 0) {
      const br = document.createElement('div');
      br.style.width = '100%';
      cameraSocials.appendChild(br);
    }
    const item = document.createElement('span');
    item.className = 'social-item';
    // Build DOM safely to prevent XSS — never use innerHTML with user input
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', SOCIAL_SVG_PATHS[platform]);
    svg.appendChild(path);
    item.appendChild(svg);
    item.appendChild(document.createTextNode(username));
    cameraSocials.appendChild(item);
  }
}

export function updateSocialsOverlay(socials: Record<string, string> | undefined): void {
  if (socials) {
    buildSocialsDOM(socials);
    positionSocialsOverlay();
  } else {
    activeSocials = [];
    cameraSocials.innerHTML = '';
    cameraSocials.classList.remove('active');
  }
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

export function positionSocialsOverlay(): void {
  const hasCam = cameraContainer.classList.contains('active');
  if (activeSocials.length === 0 || !hasCam) {
    cameraSocials.classList.remove('active');
    return;
  }

  const isVertical = activeAspectRatio === '9:16' || activeAspectRatio === '4:5';

  if (isVertical) {
    // Vertical: socials go below the bottom edge of the screen video, centred
    // Use the camera container's actual bottom edge + gap
    const camBottom = cameraContainer.offsetTop + cameraContainer.offsetHeight;
    cameraSocials.style.left = '24px';
    cameraSocials.style.right = '';
    cameraSocials.style.transform = '';
    cameraSocials.style.top = `${camBottom + 8}px`;
  } else {
    // Landscape: position below the camera (22% wide, 70% tall, vertically centred)
    const containerH = previewContainer.clientHeight;
    const camH = containerH * 0.7;
    const camBottom = (containerH + camH) / 2;
    const socialsTop = camBottom + 8;
    const camWidthPct = 22;
    if (currentLayout === 'camera-left') {
      cameraSocials.style.right = '';
      cameraSocials.style.left = '24px';
      cameraSocials.style.transform = '';
    } else {
      cameraSocials.style.left = '';
      cameraSocials.style.right = `calc(24px + ${camWidthPct}%)`;
      cameraSocials.style.transform = 'translateX(100%)';
    }
    cameraSocials.style.top = `${Math.round(socialsTop)}px`;
  }

  cameraSocials.classList.add('active');
}

/** Clear all socials state and DOM. */
export function clearSocials(): void {
  activeSocials = [];
  cameraSocials.innerHTML = '';
  cameraSocials.classList.remove('active');
}
