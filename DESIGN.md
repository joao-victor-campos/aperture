# Aperture · Design System

Direction **D · Hybrid** — Linear precision × Atelier warmth.
Light + dark, both feel crafted. Restyle-only — no layout or framework change.

## Personality
- **Calm, editorial chrome.** Warm paper background, generous hairlines, small-caps section labels. The app should feel like a writing tool that happens to run SQL — not a control panel.
- **Precise, dense data.** Pill tabs, breadcrumb connection switcher, mono numerics, status pills, ⌘K hero. Information arrives crisply.
- **Quiet accent.** A single refined terracotta drives state, selection, and the run button. Never used as decoration.

## Palette

### Token names (preserved from previous build — no component edits needed)
| Token            | Light          | Dark           | Use                                 |
| ---------------- | -------------- | -------------- | ----------------------------------- |
| `bg`             | `#FAF7F1` paper | `#15110D` coffee | App background, top bar             |
| `surface`        | `#FFFFFF`      | `#1B1611`      | Editor canvas, results, cards       |
| `sidebar` *(new)*| `#F4F0E7`      | `#12100C`      | Sidebar panel                       |
| `elevated`       | `#F8F5EC`      | `#231C15`      | Hover, button fill                  |
| `border`         | `#E6DFCC`      | `~rgba(245,229,200,.07)` | Default hairline             |
| `border-2` *(new)*| `#D7CEB6`     | stronger       | Emphasized hairline                 |
| `text`           | `#1A1816`      | `#F2EBDC`      | Primary ink                         |
| `text-2`         | `#5E574B`      | `#A89F8E`      | Secondary                           |
| `text-3`         | `#8F887A`      | `#736B5D`      | Muted                               |
| `text-4` *(new)* | `#BBB3A2`      | `#4A4438`      | Disabled / decorative numerals      |
| `accent`         | `#C8633B`      | `#D97757`      | Run button, active selection, dot   |
| `accent-hover`   | `#B3522B`      | `#E28764`      | Hover                               |
| `accent-subtle`  | `#F6E2D5`      | warm coffee tint | Active row / open dataset bg      |
| `accent-sub-2` *(new)* | `#F0D3C0` | deeper       | Selected row, pressed              |
| `accent-text`    | `#9C4A28`      | `#F0A580`      | Inline accent text                  |

### New semantic tokens
| Token            | Light       | Dark        | Use                          |
| ---------------- | ----------- | ----------- | ---------------------------- |
| `ok` / `-subtle` | `#2E8B6A`   | `#5BC98A`   | Healthy, success, complete   |
| `warn` / `-subtle` | `#B07B1A` | `#E5B547`   | Slow query, pending          |
| `err` / `-subtle`| `#B0413E`   | `#F37974`   | Errors                       |
| `cat-blue` (+subtle) | `#2E6FB8` | `#7AB3F0` | BigQuery / NEW badges        |
| `cat-purple`     | `#6D4FA8`   | `#B69BFF`   | Views                        |
| `cat-green`      | `#2E8B6A`   | `#5BC98A`   | Tables                       |

## Typography
- **UI:** system stack (`-apple-system`, `SF Pro Text`, `Segoe UI`) — clean macOS-native, no custom font load.
- **Mono:** `JetBrains Mono` / `SF Mono` for SQL, table cells, kbd chips, status numerals.
- **Body size:** 13px. **Sidebar / chrome:** 11.5–12.5px. **Numerals always tabular** (`.font-tabular`).
- **Section labels:** small-caps, 10.5px, `letter-spacing: 0.10em`, `text-3` colour. Quiet, editorial.

## Chrome system

### Top bar (46px)
1. **Brand**: `APERTURE` in 12px small-caps next to the aperture mark, terracotta blades.
2. **Connection breadcrumb**: `snowflake / prod_warehouse` with a status dot. Click → dropdown of connections; secondary action `+` for new.
3. **HEALTHY · 42ms** status pill — `ok-subtle` bg, `ok` text. Hides when latency unknown.
4. **⌘K hero** — center, 360px, hairline, placeholder "Jump to table, query, or run…". The single global entrypoint.
5. **Icon buttons**: theme toggle, notifications. Avatar on the right.

### Sidebar (264px)
1. **Segmented pill tabs**: `Catalog (42) / Saved (18) / History (128)`. Counts inline, small.
2. **Filter input** below — hairline, `/` shortcut.
3. **Pinned** section — small-caps label, terracotta bookmark icon, table name bold, dataset path muted, row count tabular-aligned right.
4. **Datasets** section — collapsible groups. Open group gets `accent-subtle` background. Tables inside use `cat-green` icons, views use `cat-purple`. Active table gets `accent-sub-2` background and a 2px terracotta left rail.
5. **Footer**: sync status with dot, version number muted right.

### Tab bar (40px)
- Pill-style. Active tab: `surface` bg with `app-pill` shadow (inset hairline + tiny drop).
- Saved query: terracotta bookmark icon prefix.
- Running query: pulsing terracotta dot.
- Right-side stat: `Last run · 8.95s · 6.0M rows` in muted small text.

## Component recipes

### Status pill (used for HEALTHY, OK, WARN)
```tsx
<span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide
                 bg-app-ok-subtle text-app-ok font-tabular">
  HEALTHY · 42ms
</span>
```

### Connection breadcrumb
```tsx
<button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-ui hover:bg-app-elevated">
  <span className="app-dot app-dot--ok" />
  <span className="font-semibold text-app-text">snowflake</span>
  <span className="text-app-text-3">/</span>
  <span className="text-app-text-2">prod_warehouse</span>
  <ChevronDown className="w-2.5 h-2.5 text-app-text-3" />
</button>
```

### Sidebar segmented tabs
```tsx
<div className="app-segmented">
  <button data-active="true">Catalog <span className="text-app-text-3">42</span></button>
  <button>Saved <span className="text-app-text-4">18</span></button>
  <button>History <span className="text-app-text-4">128</span></button>
</div>
```

### Active table row in sidebar
```tsx
<div className="flex items-center gap-1.5 pl-9 pr-3.5 py-1 text-ui
                bg-app-accent-sub-2 text-app-text
                border-l-2 border-app-accent">
  <TableIcon className="text-app-cat-green" />
  <span className="font-bold">LINEITEM</span>
  <span className="ml-auto text-[10px] text-app-text-3 font-tabular">6.0M</span>
</div>
```

## Migration notes
1. Drop the two files (`index.css`, `tailwind.config.ts`) into your repo — they preserve every existing token name, so no component file requires changes.
2. The dark theme is the default (`html { @apply dark }`) — remove that line if you want OS-preference default.
3. New tokens (`app-sidebar`, `app-border-2`, `app-text-4`, `app-accent-sub-2`, `app-ok/-subtle`, `app-warn/-subtle`, `app-err/-subtle`, `app-cat-*`) are additive — adopt them as you refactor components, no hurry.
4. Component primitives (`.app-segmented`, `.app-section-label`, `.app-dot`, `.app-kbd`) are optional helpers in `@layer components`.

## Out of scope (next round if you want)
- Connection modal restyle
- Table detail panel restyle
- Empty / running / cancelled / error states
- ⌘K command palette implementation
- Per-engine accents (BigQuery blue, Postgres slate)
