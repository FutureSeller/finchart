/** The SVG assets — CSS paints the stroke (`stroke: currentColor`). */
export const ICONS = {
  cursor: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  horizontal:
    '<svg viewBox="0 0 24 24"><path d="M4 12h16"/><circle cx="12" cy="12" r="1.8"/></svg>',
  trend:
    '<svg viewBox="0 0 24 24"><path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/></svg>',
  fib: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 11h16M4 15h16M4 18h16"/></svg>',
  magnet:
    '<svg viewBox="0 0 24 24"><path d="M6 4v7a6 6 0 0 0 12 0V4M6 4h4v7M14 4h4v7" transform="rotate(180 12 10)"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12"/></svg>',
  live: '<svg viewBox="0 0 24 24"><path d="M5 5l7 7-7 7M12 5l7 7-7 7"/></svg>',
} as const;
