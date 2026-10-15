import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  return {
    name: "Leo's Internship Tracker",
    short_name: 'Internships',
    description: 'Keyboard-driven tracker for PM & SWE internships across US, Canada, UK, and APAC.',
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: 'standalone',
    background_color: '#121318',
    theme_color: '#121318',
    icons: [
      {
        src: `${basePath}/apple-touch-icon.png`,
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: `${basePath}/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${basePath}/icon-maskable-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: `${basePath}/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${basePath}/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
