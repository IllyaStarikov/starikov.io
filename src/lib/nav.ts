/*
 * Static navigation model for the app shell.
 *
 * The sidebar is a filesystem: five groups (Index / Projects / Tools /
 * Academia / Writing) whose items are routes. Most routes 404 today and fill
 * in over Tasks 9-18 -- expected. This module is the single source of truth for
 * the tree, the ">8 entries -> slice 8 + All N ->" rule, and longest-prefix
 * active detection (rendered server-side so it is correct with no JS).
 *
 * Tools seam: the Tools group is empty in v1. Task 9 will call getCollection
 * ('tools') and pass the result to buildNav(tools) -- the shape is fixed here.
 */

export interface NavItem {
  href: string;
  label: string;
  /** ISO date, used only to order sliced groups (most-recent first). */
  updated?: string;
  /** Renders dimmed -- e.g. the placeholder link in the empty Tools group. */
  muted?: boolean;
  /** Opens in a new tab with a `↗` glyph. */
  external?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Section landing route; the target of the "All N ->" overflow link. */
  index?: { href: string };
}

/** Tool injected by Task 9 from getCollection('tools'). */
export interface ToolRef {
  slug: string;
  title: string;
  updated?: string;
}

/** Project injected from getCollection('projects'), already sorted (featured
 *  first, by `order`) by the caller. `label` is the human title, not the slug. */
export interface ProjectRef {
  slug: string;
  label: string;
}

/** The six flagship slugs, kept as the buildNav fallback so the Projects group
 *  still renders if no collection is injected. The live tree comes from the
 *  `projects` collection (Shell injects it), so a new curated project appears in
 *  the sidebar with no edit here. */
export const FLAGSHIP_PROJECTS = [
  'dotfiles',
  'eclecta',
  'mcp-servers',
  'artificial',
  'resume',
  'profile',
] as const;

const FALLBACK_PROJECTS: ProjectRef[] = FLAGSHIP_PROJECTS.map((slug) => ({ slug, label: slug }));

export const GITHUB_URL = 'https://github.com/IllyaStarikov';

/** Groups >8 entries collapse to the 8 most-recent + an "All N ->" link. */
export const SLICE_LIMIT = 8;

/**
 * Build the nav tree. `tools` and `projects` are injected from their collections
 * by Shell (`buildNav(toolRefs, projectRefs)`); both default to a fallback so
 * the tree still renders standalone. Projects arrive pre-sorted (featured first,
 * by `order`).
 */
export function buildNav(
  tools: ToolRef[] = [],
  projects: ProjectRef[] = FALLBACK_PROJECTS,
): NavGroup[] {
  return [
    {
      label: 'Index',
      items: [
        { href: '/', label: 'Home' },
        { href: '/about', label: 'About' },
        { href: '/colophon', label: 'Colophon' },
        { href: '/changelog', label: 'Changelog' },
      ],
    },
    {
      label: 'Projects',
      index: { href: '/projects' },
      items: projects.map((p) => ({ href: `/projects/${p.slug}`, label: p.label })),
    },
    {
      // Populated at build from getCollection('tools') in Task 9.
      label: 'Tools',
      index: { href: '/bin' },
      items: tools.map((t) => ({
        href: `/bin/${t.slug}`,
        label: t.title || t.slug,
        updated: t.updated,
      })),
    },
    {
      label: 'Academia',
      items: [{ href: '/academia', label: 'Academia' }],
    },
    {
      label: 'Writing',
      items: [{ href: '/writing', label: 'Writing' }],
    },
  ];
}

export interface SlicedGroup {
  items: NavItem[];
  /** The group's "All <label> ->" landing-page link. Present whenever the
   *  group declares `index`, independent of item count -- it is the only way
   *  to reach a group's index page when the group has 1-8 items inline
   *  (previously reachable only when the group was empty or >8, backlog #12). */
  indexLink?: NavItem;
}

/**
 * Apply the slice rule (<=8 items pass through untouched, in declared order;
 * >8 are sorted by `updated` desc and cut to 8) and attach the group's index
 * link when declared. The index link ALWAYS renders when `group.index` is
 * set -- slicing and index-link presence are independent concerns.
 */
export function sliceGroup(group: NavGroup): SlicedGroup {
  const { items } = group;
  const indexLink: NavItem | undefined = group.index
    ? { href: group.index.href, label: `All ${group.label.toLowerCase()} →` }
    : undefined;
  if (items.length <= SLICE_LIMIT) return { items, indexLink };
  const sorted = [...items].sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  return { items: sorted.slice(0, SLICE_LIMIT), indexLink };
}

/**
 * Longest-prefix active detection. `/` matches only itself; every other href
 * matches an exact path or a descendant (`/bin` -> `/bin/x`). Returns the href
 * of the single active item, or null. Pure, so shell.ts reuses the same rule
 * client-side against location.pathname (the sidebar persists across swaps and
 * must be re-resolved without a server round-trip).
 */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function activeHref(pathname: string, groups: NavGroup[]): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (isActive(item.href, pathname) && (best === null || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}
