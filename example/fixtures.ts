export interface Fixture {
  name: string;
  description: string;
  xml: string;
}

const floorPlan = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">
  <title>Synthetic floor plan</title>
  <rect width="800" height="520" fill="#f4f5f7"/>
  <g id="walls" fill="none" stroke="#2b2f36" stroke-width="4">
    <rect x="40" y="40" width="720" height="440" rx="6"/>
    <line x1="40" y1="280" x2="470" y2="280"/>
    <line x1="470" y1="40" x2="470" y2="480"/>
  </g>
  <g id="rooms" stroke="#2b2f36" stroke-width="1.5">
    <rect id="room-a1" class="room" x="60" y="60" width="180" height="200" fill="#dbeafe"/>
    <rect id="room-a2" class="room" x="260" y="60" width="190" height="200" fill="#dcfce7"/>
    <polygon id="room-b1" class="room" points="60,300 300,300 300,460 180,460 180,400 60,400" fill="#fef3c7"/>
    <path id="room-b2" class="room" d="M320 300 H450 V460 H320 Z" fill="#fde2e4"/>
    <g id="wing" transform="translate(490 60) rotate(-4 0 0)">
      <rect id="room-c1" class="room" x="0" y="0" width="250" height="120" fill="#ede9fe" transform="skewX(-3)"/>
      <ellipse id="stage" class="room" cx="125" cy="260" rx="110" ry="70" fill="#fee2e2"/>
    </g>
  </g>
  <g id="labels" font-family="Helvetica, Arial, sans-serif" font-size="18" text-anchor="middle" fill="#1f2937">
    <text x="150" y="165">Hall A1</text>
    <text x="355" y="165">Hall A2</text>
    <text x="170" y="360">Hall B1</text>
    <text x="385" y="385">Hall B2</text>
    <text x="615" y="130" transform="rotate(-4 615 130)">Wing C1</text>
    <text x="615" y="325" font-style="italic" font-size="16">Main <tspan font-weight="bold" fill="#b91c1c">stage</tspan></text>
  </g>
  <g id="doors" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 4" fill="none">
    <path d="M240 150 a20 20 0 0 1 20 20"/>
    <path d="M300 380 a20 20 0 0 0 20 -20"/>
  </g>
  <circle cx="750" cy="470" r="8" fill="#22c55e"><title>Exit</title></circle>
</svg>`;

const shapes = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" fill="none" stroke="#111827" stroke-width="3">
  <rect x="20" y="20" width="100" height="60" fill="#fca5a5"/>
  <rect x="140" y="20" width="100" height="60" rx="18" fill="#fdba74" stroke-dasharray="8 4"/>
  <circle cx="310" cy="50" r="30" fill="#fde047" stroke-width="6" stroke-opacity="0.5"/>
  <ellipse cx="70" cy="150" rx="50" ry="25" fill="#86efac" style="stroke: #065f46; stroke-width: 2"/>
  <line x1="140" y1="120" x2="240" y2="180" stroke-linecap="round" stroke-width="10"/>
  <polyline points="260,180 290,120 320,180 350,120 380,180" stroke-linejoin="round"/>
  <polygon points="40,200 100,240 40,240" fill="#93c5fd" fill-opacity="0.6"/>
  <g transform="translate(200 220) rotate(30)" color="#7c3aed">
    <rect x="-40" y="-15" width="80" height="30" fill="currentColor" stroke="none"/>
  </g>
  <g opacity="0.35">
    <circle cx="330" cy="225" r="25" fill="#1d4ed8"/>
    <circle cx="355" cy="225" r="25" fill="#dc2626"/>
  </g>
</svg>`;

const paths = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <path d="M20 200 C60 20 140 20 180 200 S300 380 380 200" fill="none" stroke="#0f766e" stroke-width="4"/>
  <path d="M20 120 q40 -80 80 0 t80 0 t80 0 t80 0" fill="none" stroke="#b45309" stroke-width="3" stroke-dasharray="10 6"/>
  <path d="M60 60 a30 30 0 1 1 60 0 a30 30 0 1 1 -60 0 z" fill="#fbcfe8" stroke="#9d174d" stroke-width="2"/>
  <path d="M300 30 h60 v40 h-60 z m10 10 h40 v20 h-40 z" fill="#c7d2fe" fill-rule="evenodd" stroke="#3730a3" stroke-width="2"/>
  <path d="M200 40 l20 40 h-40 z" fill="#fde68a" stroke="#92400e" stroke-width="2" stroke-linejoin="round"/>
  <path d="M40 220 A40 20 30 0 0 120 220" fill="none" stroke="#1e3a8a" stroke-width="3"/>
</svg>`;

const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" font-family="Georgia, serif">
  <text x="20" y="40" font-size="28" fill="#111827">Georgia <tspan fill="#dc2626" font-weight="bold">bold</tspan> <tspan font-style="italic" fill="#2563eb">italic</tspan></text>
  <text x="200" y="90" font-size="20" text-anchor="middle" fill="#065f46">centered on 200</text>
  <text x="380" y="130" font-size="20" text-anchor="end" fill="#7c2d12">right aligned</text>
  <text x="20" y="180" font-size="16" letter-spacing="4" fill="#4b5563">L E T T E R S P A C I N G</text>
  <line x1="200" y1="60" x2="200" y2="100" stroke="#a3a3a3" stroke-dasharray="2 2"/>
</svg>`;

const cssClasses = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160">
  <defs>
    <style>
      .booth { fill: #bfdbfe; stroke: #1e40af; stroke-width: 2; }
      .aisle { fill: none; stroke: #9ca3af; stroke-width: 1; stroke-dasharray: 4 2; }
      #vip { fill: #fcd34d; }
    </style>
  </defs>
  <rect class="booth" x="20" y="20" width="70" height="50"/>
  <rect class="booth" x="110" y="20" width="70" height="50"/>
  <rect class="booth" id="vip" x="200" y="20" width="80" height="50"/>
  <line class="aisle" x1="20" y1="90" x2="280" y2="90"/>
  <rect class="booth" x="20" y="100" width="260" height="40"/>
</svg>`;

/** Grid of booths with hairline aisles: many elements, few paint styles. */
export function generateGrid(rows: number, cols: number): string {
  const cell = 24;
  const gap = 6;
  const width = cols * (cell + gap) + gap;
  const height = rows * (cell + gap) + gap;
  const fills = ['#dbeafe', '#dcfce7', '#fef3c7', '#fde2e4', '#ede9fe', '#e0f2fe'];
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#f8fafc"/>`,
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gap + c * (cell + gap);
      const y = gap + r * (cell + gap);
      const fill = fills[(r * 7 + c) % fills.length];
      parts.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}" stroke="#334155" stroke-width="0.5"/>`
      );
    }
    const y = gap / 2 + r * (cell + gap);
    parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#cbd5e1" stroke-width="0.25"/>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export const FIXTURES: Fixture[] = [
  {
    name: 'Floor plan',
    description:
      'Synthetic venue: rooms as rect, polygon, path and ellipse, a rotated wing with a skewed room, labels with tspans, dashed door arcs.',
    xml: floorPlan,
  },
  {
    name: 'Shapes',
    description: 'Every basic shape with fills, strokes, dashes, caps, joins, inline style, currentColor and group opacity.',
    xml: shapes,
  },
  {
    name: 'Paths',
    description: 'Cubic and quadratic curves with shorthands, arcs, relative commands and evenodd fill rule.',
    xml: paths,
  },
  {
    name: 'Text',
    description: 'Text with mixed tspans, anchors and letter spacing. Font matching is best effort per platform.',
    xml: text,
  },
  {
    name: 'CSS classes',
    description:
      'Illustrator-style export styled through a <style> block. Not applied yet (phase 1): shapes fall back to default paint and a warning is reported.',
    xml: cssClasses,
  },
  {
    name: 'Grid 1k',
    description: '1,000 booths plus hairline aisles in 8 paint styles. Style batching (phase 1) will collapse this to a handful of draw units.',
    xml: generateGrid(25, 40),
  },
];
