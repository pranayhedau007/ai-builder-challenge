import type { Location } from "./types";

// Parses "Site/Room/Row/Rack/RU" barcode strings into a Location object.
// 5-part → all fields. 4-part → site/room/rack/ru (no row).
// 3-part → site/room/rack (no row, no ru). Shorter → site only.
export function parseLocationString(str: string): Location {
  const p = str.split("/");
  if (p.length >= 5)
    return {
      site: p[0] ?? "",
      room: p[1] ?? null,
      row: p[2] ?? null,
      rack: p[3] ?? null,
      ru: p[4] ?? null,
    };
  if (p.length === 4)
    return {
      site: p[0] ?? "",
      room: p[1] ?? null,
      row: null,
      rack: p[2] ?? null,
      ru: p[3] ?? null,
    };
  if (p.length === 3)
    return {
      site: p[0] ?? "",
      room: p[1] ?? null,
      row: null,
      rack: p[2] ?? null,
      ru: null,
    };
  return { site: p[0] ?? "", room: p[1] ?? null, row: null, rack: null, ru: null };
}

export function formatLocation(loc: Location): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru].filter(Boolean).join(" / ");
}

// Builds the flat "Site/Room/Row/Rack/RU" string the facilities mock expects.
export function buildFacilitiesString(loc: Location): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru].filter(Boolean).join("/");
}

export function formatShortLocation(loc: Location): string {
  if (loc.rack && loc.ru) return `${loc.rack} / ${loc.ru}`;
  if (loc.rack) return loc.rack;
  if (loc.room) return `${loc.site} / ${loc.room}`;
  return loc.site;
}
