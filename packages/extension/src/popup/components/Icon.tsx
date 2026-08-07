import type { SVGProps } from 'react';

export type IconName = 'settings' | 'chevron' | 'sparkle' | 'arrow' | 'folder' | 'refresh' | 'check' | 'close' | 'move' | 'edit' | 'merge' | 'trash';

export default function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const shared = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, JSX.Element> = {
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.09A1.7 1.7 0 0 0 10.68 18.35a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.02 14.7a1.7 1.7 0 0 0-1.56-1.03H5v-3h.46A1.7 1.7 0 0 0 7.02 9.64 1.7 1.7 0 0 0 6.68 7.76l-.06-.06L8.74 5.6l.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4h3v.44a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H20v3h-.04A1.7 1.7 0 0 0 18.4 14.7Z" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    sparkle: <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-3.8L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.9 3.8L21 14" /><path d="M21 19v-5h-5" /></>,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    move: <><path d="M12 3v18M3 12h18" /><path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></>,
    edit: <><path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m13.8 7.2 3 3" /></>,
    merge: <><path d="M7 4v4c0 2.2 1.8 4 4 4h6" /><path d="m14 9 3 3-3 3" /><path d="M7 20v-4c0-2.2 1.8-4 4-4" /></>,
    trash: <><path d="M4 7h16M10 11v5m4-5v5M9 7l1-3h4l1 3m-9 0 1 13h10l1-13" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...shared} {...props}>{paths[name]}</svg>;
}
