import { unzipSync } from "fflate";

/**
 * A minimal reader for the cell values of an .xlsx workbook: enough for a plain table (inline and
 * shared strings, numbers, booleans). Formulas yield their cached value; styles are ignored.
 */

/** One sheet row: column letter → cell text. Empty cells are absent. */
export type SheetRow = Record<string, string>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? undefined;

/** The text of every `<t>` inside a string item (rich-text runs are concatenated). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1] ?? "")).join("");

export class Workbook {
  private readonly files: Record<string, Uint8Array>;
  private readonly sheets = new Map<string, string>();
  private readonly shared: string[];
  private readonly decoder = new TextDecoder();

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes);
    const rels = new Map<string, string>();
    for (const [, tag] of this.read("xl/_rels/workbook.xml.rels").matchAll(
      /(<Relationship\s[^>]*>)/g,
    )) {
      const id = attr(tag ?? "", "Id");
      const target = attr(tag ?? "", "Target");
      if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
    for (const [, tag] of this.read("xl/workbook.xml").matchAll(/(<sheet\s[^>]*>)/g)) {
      const name = attr(tag ?? "", "name");
      const path = rels.get(attr(tag ?? "", "r:id") ?? "");
      if (name && path) this.sheets.set(decodeXml(name), path);
    }
    const sharedXml = this.files["xl/sharedStrings.xml"] ? this.read("xl/sharedStrings.xml") : "";
    this.shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] ?? ""));
  }

  private read(path: string): string {
    const file = this.files[path];
    if (!file) throw new Error(`workbook has no ${path}`);
    return this.decoder.decode(file);
  }

  sheetNames(): string[] {
    return [...this.sheets.keys()];
  }

  /** The rows of a sheet in order, each with its 1-based row number. Throws for an unknown sheet. */
  rows(sheet: string): { row: number; cells: SheetRow }[] {
    const path = this.sheets.get(sheet);
    if (!path) throw new Error(`workbook has no sheet "${sheet}"`);
    const out: { row: number; cells: SheetRow }[] = [];
    for (const [, rowTag, body] of this.read(path).matchAll(
      /(<row\s[^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,
    )) {
      const cells: SheetRow = {};
      for (const [, cellTag, cellBody] of (body ?? "").matchAll(
        /(<c\s[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const column = attr(cellTag ?? "", "r")?.match(/^[A-Z]+/)?.[0];
        if (!column) continue;
        const value = this.cellValue(attr(cellTag ?? "", "t"), cellBody ?? "");
        if (value !== "") cells[column] = value;
      }
      out.push({ row: Number(attr(rowTag ?? "", "r") ?? out.length + 1), cells });
    }
    return out;
  }

  private cellValue(type: string | undefined, body: string): string {
    if (type === "inlineStr") return textOf(body).trim();
    const raw = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
    if (type === "s") return (this.shared[Number(raw)] ?? "").trim();
    return raw.trim();
  }
}
