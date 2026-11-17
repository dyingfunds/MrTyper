/**
 * Opening files as scripts: plain text as it is, and Word (.docx) or Markdown
 * files turned into a script whose {{…}} commands recreate the formatting in
 * Google Docs. Both formats go through the same paragraph model, so they get
 * the same rules for headings, lists, alignment and text styles.
 */

import { normalizeScript } from "./utils";

/** Plain-text and Markdown files larger than this are almost certainly not a script. */
export const MAX_TEXT_BYTES = 1_500_000;
/** Word files carry images and fonts, so they are allowed to be bigger. */
export const MAX_DOCX_BYTES = 30_000_000;

export type ScriptFileKind = "text" | "markdown" | "docx";

export interface ImportedScript {
  text: string;
  kind: ScriptFileKind;
}

export function scriptFileKind(name: string): ScriptFileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "text";
}

/**
 * Read a file as a script. With `commands` off, formatting is dropped and only
 * the words are kept, since commands would otherwise be typed literally.
 * Throws an Error with a message meant for the user.
 */
export async function readScriptFile(file: File, commands: boolean): Promise<ImportedScript> {
  const kind = scriptFileKind(file.name);
  const limit = kind === "docx" ? MAX_DOCX_BYTES : MAX_TEXT_BYTES;
  if (file.size > limit) {
    throw new Error(
      kind === "docx"
        ? "That Word file is over 30 MB. Save a copy without images and try again."
        : "That file is over 1.5 MB, which is too big for a script.",
    );
  }

  if (kind === "docx") {
    const xml = await readDocxParts(new Uint8Array(await file.arrayBuffer()));
    return { kind, text: renderScript(docxParagraphs(xml), commands) };
  }

  const contents = await file.text();
  if (contents.includes("\u0000")) {
    throw new Error("MrTyper can open plain text, Markdown and Word (.docx) files.");
  }
  if (kind === "markdown") {
    return { kind, text: renderScript(markdownParagraphs(normalizeScript(contents)), commands) };
  }
  return { kind, text: normalizeScript(contents) };
}

/* ------------------------------------------------------------------ */
/*  Paragraph model                                                    */
/* ------------------------------------------------------------------ */

type Style = "bold" | "italic" | "underline" | "strike" | "sup" | "sub";
const STYLES: Style[] = ["bold", "italic", "underline", "strike", "sup", "sub"];

interface Run {
  text: string;
  styles: Set<Style>;
}

type ListKind = "bullets" | "numbers" | "checklist";
type Align = "left" | "center" | "right" | "justify";

interface Paragraph {
  runs: Run[];
  /** 1–6 for a heading. */
  heading: number | null;
  list: { kind: ListKind; level: number } | null;
  align: Align;
  /** A page break comes before this paragraph. */
  pageBreakBefore?: boolean;
}

const ALIGN_COMMAND: Record<Align, string> = {
  left: "alignleft",
  center: "center",
  right: "alignright",
  justify: "justify",
};

const cmd = (token: string) => `{{${token}}}`;

/** A line break inside a paragraph (Shift+Enter in Word). */
const SOFT_BREAK = " ";

/** Turn paragraphs into a script. Commands follow how Google Docs behaves while typing. */
export function renderScript(paragraphs: Paragraph[], commands: boolean): string {
  if (!commands) {
    return paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n")
      .replaceAll(SOFT_BREAK, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Trim empty paragraphs at both ends; they would only type blank lines.
  const isEmpty = (paragraph: Paragraph) =>
    paragraph.runs.every((run) => run.text.trim() === "") && !paragraph.pageBreakBefore;
  let start = 0;
  let end = paragraphs.length;
  while (start < end && isEmpty(paragraphs[start])) start += 1;
  while (end > start && isEmpty(paragraphs[end - 1])) end -= 1;

  const lines: string[] = [];
  let previousList: Paragraph["list"] = null;
  let previousHeading: number | null = null;
  let align: Align = "left";

  for (const paragraph of paragraphs.slice(start, end)) {
    let line = "";
    if (paragraph.pageBreakBefore) line += cmd("pagebreak");

    // An empty paragraph inside a list ends the list, as Enter twice would.
    const list = isEmpty(paragraph) ? null : paragraph.list;

    if (previousList && !list) {
      line += cmd("outdent").repeat(previousList.level) + cmd(previousList.kind);
    } else if (list && !previousList) {
      line += cmd(list.kind) + cmd("indent").repeat(list.level);
    } else if (list && previousList) {
      const change = list.level - previousList.level;
      line += cmd(change > 0 ? "indent" : "outdent").repeat(Math.abs(change));
      if (list.kind !== previousList.kind) line += cmd(list.kind);
    }

    if (paragraph.heading) {
      line += cmd(`h${paragraph.heading}`);
    } else if (previousHeading) {
      line += cmd("normal");
    }

    if (paragraph.align !== align) {
      line += cmd(ALIGN_COMMAND[paragraph.align]);
      align = paragraph.align;
    }

    // Text styles toggle on and off around runs, and never cross a line.
    const open = new Set<Style>();
    for (const run of paragraph.runs) {
      if (!run.text) continue;
      for (const style of STYLES) {
        if (open.has(style) !== run.styles.has(style)) {
          line += cmd(style);
          if (open.has(style)) open.delete(style);
          else open.add(style);
        }
      }
      line += run.text;
    }
    for (const style of STYLES) if (open.has(style)) line += cmd(style);

    lines.push(line);
    previousList = list;
    previousHeading = paragraph.heading;
  }

  return lines.join("\n").replaceAll(SOFT_BREAK, cmd("shift+enter"));
}

/* ------------------------------------------------------------------ */
/*  Markdown                                                           */
/* ------------------------------------------------------------------ */

/** Inline Markdown: **bold**, *italic*, ~~strike~~, `code` and [links](url). */
function markdownRuns(source: string): Run[] {
  const runs: Run[] = [];
  const active = new Set<Style>();
  let buffer = "";
  const flush = () => {
    if (buffer) runs.push({ text: buffer, styles: new Set(active) });
    buffer = "";
  };
  const toggle = (style: Style) => {
    flush();
    if (active.has(style)) active.delete(style);
    else active.add(style);
  };

  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const character = source[index];

    if (character === "\\" && index + 1 < source.length) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }
    if (character === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index) {
        buffer += source.slice(index + 1, close);
        index = close + 1;
        continue;
      }
    }
    const link = /^!?\[([^\]]*)\]\([^)]*\)/.exec(rest);
    if (link) {
      buffer += link[1];
      index += link[0].length;
      continue;
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      if (canToggle(source, index, 2, active.has("bold"))) {
        toggle("bold");
        index += 2;
        continue;
      }
    }
    if (rest.startsWith("~~") && canToggle(source, index, 2, active.has("strike"))) {
      toggle("strike");
      index += 2;
      continue;
    }
    if ((character === "*" || character === "_") && canToggle(source, index, 1, active.has("italic"))) {
      toggle("italic");
      index += 1;
      continue;
    }
    buffer += character;
    index += 1;
  }
  flush();

  // A marker that never closed was plain text after all; dropping the style
  // is closer to what the writer meant than typing the asterisks.
  return runs;
}

/** Whether a run of `size` marker characters at `index` opens or closes a style. */
function canToggle(source: string, index: number, size: number, isOpen: boolean): boolean {
  const before = source[index - 1] ?? " ";
  const after = source[index + size] ?? " ";
  const marker = source.slice(index, index + size);
  if (isOpen) return !/\s/.test(before);
  // Opening needs a closing partner later on the line, and text right after it.
  if (/\s/.test(after)) return false;
  // Underscores inside words (snake_case) are not emphasis.
  if (marker[0] === "_" && /\w/.test(before)) return false;
  return source.indexOf(marker, index + size + 1) !== -1;
}

export function markdownParagraphs(source: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let inFence = false;

  for (const raw of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      paragraphs.push({ runs: [{ text: raw, styles: new Set() }], heading: null, list: null, align: "left" });
      continue;
    }

    let line = raw;
    let heading: number | null = null;
    let list: Paragraph["list"] = null;

    const headingMatch = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      // A horizontal rule has no keyboard equivalent; leave a blank line.
      line = "";
    } else if (headingMatch) {
      heading = headingMatch[1].length;
      line = headingMatch[2];
    } else if (listMatch) {
      const indent = listMatch[1].replace(/\t/g, "    ").length;
      const kind: ListKind = listMatch[3]
        ? "checklist"
        : /\d/.test(listMatch[2])
          ? "numbers"
          : "bullets";
      list = { kind, level: Math.min(8, Math.floor(indent / 2)) };
      line = listMatch[4];
    } else {
      line = line.replace(/^\s{0,3}>\s?/, "");
    }

    paragraphs.push({ runs: markdownRuns(line), heading, list, align: "left" });
  }

  // Levels may skip (a 4-space indent under a top item); keep them stepwise.
  let previous = -1;
  for (const paragraph of paragraphs) {
    if (!paragraph.list) {
      previous = -1;
      continue;
    }
    paragraph.list.level = Math.min(paragraph.list.level, previous + 1);
    previous = paragraph.list.level;
  }
  return paragraphs;
}

/* ------------------------------------------------------------------ */
/*  Word (.docx)                                                       */
/* ------------------------------------------------------------------ */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface DocxParts {
  document: string;
  styles: string | null;
  numbering: string | null;
}

async function readDocxParts(bytes: Uint8Array): Promise<DocxParts> {
  let entries: Map<string, ZipEntry>;
  try {
    entries = readZipDirectory(bytes);
  } catch {
    throw new Error("That file isn't a Word document MrTyper can read. Save it as .docx and try again.");
  }
  const read = async (name: string) => {
    const entry = entries.get(name);
    return entry ? inflateEntry(bytes, entry) : null;
  };
  const document = await read("word/document.xml");
  if (!document) {
    throw new Error("That file isn't a Word document MrTyper can read. Save it as .docx and try again.");
  }
  return {
    document,
    styles: await read("word/styles.xml"),
    numbering: await read("word/numbering.xml"),
  };
}

function wAttr(element: Element | null | undefined, name: string): string | null {
  if (!element) return null;
  return element.getAttributeNS(W, name) ?? element.getAttribute(`w:${name}`);
}

function wChild(element: Element | null | undefined, name: string): Element | null {
  if (!element) return null;
  for (const child of Array.from(element.children)) {
    if (child.localName === name) return child;
  }
  return null;
}

/** A toggle property such as <w:b/> or <w:b w:val="false"/>. */
function isOn(element: Element | null): boolean {
  if (!element) return false;
  const value = wAttr(element, "val");
  return value === null || !["0", "false", "off", "none"].includes(value.toLowerCase());
}

function parseXml(source: string): Document {
  const parsed = new DOMParser().parseFromString(source, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length) {
    throw new Error("That Word document looks damaged. Open it in Word and save it again.");
  }
  return parsed;
}

/** Style id → heading level, from the style names ("heading 1", "Title"). */
function headingStyles(styles: string | null): Map<string, number> {
  const headings = new Map<string, number>();
  if (!styles) return headings;
  for (const style of Array.from(parseXml(styles).getElementsByTagNameNS(W, "style"))) {
    const id = wAttr(style, "styleId");
    const name = wAttr(wChild(style, "name"), "val")?.toLowerCase() ?? "";
    if (!id) continue;
    const match = /^heading\s*([1-6])$/.exec(name);
    if (match) headings.set(id, Number(match[1]));
    else if (name === "title") headings.set(id, 1);
    else if (name === "subtitle") headings.set(id, 2);
  }
  return headings;
}

/** numId → level → whether that list level is bulleted. */
function listFormats(numbering: string | null): Map<string, Map<number, ListKind>> {
  const formats = new Map<string, Map<number, ListKind>>();
  if (!numbering) return formats;
  const xml = parseXml(numbering);
  const abstract = new Map<string, Map<number, ListKind>>();
  for (const definition of Array.from(xml.getElementsByTagNameNS(W, "abstractNum"))) {
    const id = wAttr(definition, "abstractNumId");
    if (!id) continue;
    const levels = new Map<number, ListKind>();
    for (const level of Array.from(definition.getElementsByTagNameNS(W, "lvl"))) {
      const format = wAttr(wChild(level, "numFmt"), "val");
      levels.set(Number(wAttr(level, "ilvl") ?? 0), format === "bullet" ? "bullets" : "numbers");
    }
    abstract.set(id, levels);
  }
  for (const num of Array.from(xml.getElementsByTagNameNS(W, "num"))) {
    const id = wAttr(num, "numId");
    const abstractId = wAttr(wChild(num, "abstractNumId"), "val");
    if (id && abstractId && abstract.has(abstractId)) formats.set(id, abstract.get(abstractId)!);
  }
  return formats;
}

function runStyles(properties: Element | null, inherited: Set<Style>): Set<Style> {
  const styles = new Set(inherited);
  if (!properties) return styles;
  const set = (style: Style, on: boolean | null) => {
    if (on === null) return;
    if (on) styles.add(style);
    else styles.delete(style);
  };
  const flag = (name: string) => {
    const element = wChild(properties, name);
    return element ? isOn(element) : null;
  };
  set("bold", flag("b"));
  set("italic", flag("i"));
  set("strike", flag("strike") ?? flag("dstrike"));
  const underline = wChild(properties, "u");
  if (underline) set("underline", (wAttr(underline, "val") ?? "single") !== "none");
  const vertical = wAttr(wChild(properties, "vertAlign"), "val");
  if (vertical) {
    set("sup", vertical === "superscript");
    set("sub", vertical === "subscript");
  }
  return styles;
}

export function docxParagraphs(parts: DocxParts): Paragraph[] {
  const document = parseXml(parts.document);
  const headings = headingStyles(parts.styles);
  const lists = listFormats(parts.numbering);
  const body = document.getElementsByTagNameNS(W, "body")[0];
  const paragraphs: Paragraph[] = [];
  if (!body) return paragraphs;

  // Paragraphs in reading order, including those inside tables and content controls.
  const all = Array.from(body.getElementsByTagNameNS(W, "p")).filter(
    // Text boxes nest paragraphs inside paragraphs; their text is read once, here.
    (paragraph) => !paragraph.parentElement?.closest("txbxContent"),
  );

  let pendingPageBreak = false;
  for (const element of all) {
    const properties = wChild(element, "pPr");
    const styleId = wAttr(wChild(properties, "pStyle"), "val");
    const heading = (styleId && headings.get(styleId)) || null;

    let list: Paragraph["list"] = null;
    const numbering = wChild(properties, "numPr");
    const numId = wAttr(wChild(numbering, "numId"), "val");
    if (numId && numId !== "0") {
      const level = Number(wAttr(wChild(numbering, "ilvl"), "val") ?? 0);
      list = { kind: lists.get(numId)?.get(level) ?? "bullets", level: Math.min(8, level) };
    }

    const justify = wAttr(wChild(properties, "jc"), "val");
    const align: Align =
      justify === "center"
        ? "center"
        : justify === "right" || justify === "end"
          ? "right"
          : justify === "both" || justify === "distribute"
            ? "justify"
            : "left";

    const runs: Run[] = [];
    let pageBreakAfter = false;
    for (const run of Array.from(element.getElementsByTagNameNS(W, "r"))) {
      if (run.closest("p") !== element) continue;
      if (run.parentElement?.localName === "del" || run.closest("del")) continue;
      const styles = runStyles(wChild(run, "rPr"), new Set());
      let text = "";
      for (const child of Array.from(run.children)) {
        switch (child.localName) {
          case "t":
            text += child.textContent ?? "";
            break;
          case "tab":
            text += "\t";
            break;
          case "noBreakHyphen":
            text += "-";
            break;
          case "br":
            if (wAttr(child, "type") === "page") pageBreakAfter = true;
            else text += SOFT_BREAK;
            break;
          case "cr":
            text += SOFT_BREAK;
            break;
        }
      }
      if (text) runs.push({ text, styles });
    }

    paragraphs.push({ runs, heading, list, align, pageBreakBefore: pendingPageBreak });
    pendingPageBreak = pageBreakAfter;
  }

  return paragraphs;
}

/* ------------------------------------------------------------------ */
/*  A small ZIP reader                                                 */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let entry = 0; entry < count; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("bad zip directory");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localOffset;
  if (view.getUint32(header, true) !== 0x04034b50) throw new Error("bad zip entry");
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("unsupported zip compression");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This system can't unpack Word files. Copy the text out of Word and paste it instead.");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
