import { Lexer, type Token, type Tokens } from "marked";
import type { Attributes, Delta, Op } from "./types";

export function push(ops: Op[], insert: string, attributes: Attributes = {}) {
  if (!insert) return;
  const attrs = Object.keys(attributes).length ? attributes : undefined;
  const previous = ops.at(-1);
  if (previous && JSON.stringify(previous.attributes) === JSON.stringify(attrs))
    previous.insert += insert;
  else ops.push(attrs ? { insert, attributes: attrs } : { insert });
}
export function line(ops: Op[], text: Op[], attrs: Attributes = {}) {
  // Quill applies block formats to each newline, including soft line breaks.
  for (const op of text) {
    const parts = op.insert.split("\n");
    parts.forEach((part, index) => {
      if (index) push(ops, "\n", attrs);
      push(ops, part, op.attributes);
    });
  }
  push(ops, "\n", attrs);
}

export function inline(text: string): Op[] {
  const ops: Op[] = [];
  const walk = (tokens: Token[], attrs: Attributes = {}) => {
    for (const token of tokens) {
      if (
        token.type === "strong" ||
        token.type === "em" ||
        token.type === "del"
      ) {
        const key = { strong: "bold", em: "italic", del: "strike" }[token.type];
        walk((token as Tokens.Strong).tokens, { ...attrs, [key]: true });
      } else if (token.type === "link") {
        const link = token as Tokens.Link;
        walk(link.tokens, { ...attrs, link: link.href });
      } else if (token.type === "br") push(ops, "\n", attrs);
      else if (token.type === "image") {
        const image = token as Tokens.Image;
        push(
          ops,
          image.text || image.href,
          /^https?:/i.test(image.href) ? { ...attrs, link: image.href } : attrs,
        );
      } else if (token.type === "html") {
        // Keep HTML visible as text. Never execute user-supplied markup.
        push(ops, token.raw, attrs);
      } else {
        const value = (token as Tokens.Text).text ?? token.raw;
        push(
          ops,
          value
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'"),
          attrs,
        );
      }
    }
  };
  walk(Lexer.lexInline(text));
  return ops;
}

export function markdownToDelta(
  markdown: string,
  warn: (message: string) => void,
): Delta {
  const ops: Op[] = [];
  const walk = (tokens: Token[], indent = 0, inherited: Attributes = {}) => {
    for (const token of tokens) {
      switch (token.type) {
        case "heading": {
          const h = token as Tokens.Heading;
          line(ops, inline(h.text), { header: Math.min(h.depth, 3) });
          break;
        }
        case "paragraph":
        case "text":
          line(ops, inline((token as Tokens.Text).text), inherited);
          break;
        case "code": {
          for (const text of (token as Tokens.Code).text.split("\n"))
            line(ops, [{ insert: text }], { "code-block": true });
          break;
        }
        case "blockquote":
          walk((token as Tokens.Blockquote).tokens, indent, {
            blockquote: true,
          });
          break;
        case "list": {
          const list = token as Tokens.List;
          for (const item of list.items) {
            let first = true;
            for (const child of item.tokens) {
              if (child.type === "list") {
                walk([child], indent + 1);
                continue;
              }
              if (child.type === "space") continue;
              const attrs: Attributes = first
                ? {
                    list: item.task
                      ? item.checked
                        ? "checked"
                        : "unchecked"
                      : list.ordered
                        ? "ordered"
                        : "bullet",
                  }
                : {};
              if (indent) attrs.indent = Math.min(indent, 8);
              line(
                ops,
                inline((child as Tokens.Text).text ?? child.raw),
                attrs,
              );
              first = false;
            }
          }
          break;
        }
        case "table": {
          warn(
            "Tables are preserved as text because Anchor does not support table blocks.",
          );
          const table = token as Tokens.Table;
          line(ops, [
            { insert: table.header.map((cell) => cell.text).join(" | ") },
          ]);
          for (const row of table.rows)
            line(ops, [{ insert: row.map((cell) => cell.text).join(" | ") }]);
          break;
        }
        case "hr":
          line(ops, [{ insert: "—" }]);
          break;
        case "html":
          warn("HTML is preserved as visible text.");
          line(ops, [{ insert: token.raw }]);
          break;
        case "space":
          break;
        default:
          line(ops, [{ insert: token.raw }]);
          warn(`Markdown block “${token.type}” is preserved as text.`);
      }
    }
  };
  walk(Lexer.lex(markdown));
  return { ops: ops.length ? ops : [{ insert: "\n" }] };
}

export function deltaToMarkdown(delta: Delta): string {
  let text = "";
  let current = "";
  let ordered = 0;
  for (const op of delta.ops) {
    const attrs = op.attributes ?? {};
    const parts = op.insert.split("\n");
    parts.forEach((part, index) => {
      if (index) {
        let prefix = "";
        const indent = "  ".repeat(Number(attrs.indent) || 0);
        if (attrs.header) prefix = "#".repeat(Number(attrs.header)) + " ";
        else if (attrs.list) {
          prefix =
            indent +
            (attrs.list === "checked"
              ? "- [x] "
              : attrs.list === "unchecked"
                ? "- [ ] "
                : attrs.list === "ordered"
                  ? `${++ordered}. `
                  : "- ");
        } else if (attrs.blockquote) prefix = "> ";
        if (attrs["code-block"]) text += "```\n" + current + "\n```\n";
        else text += prefix + current + "\n";
        current = "";
        if (attrs.list !== "ordered") ordered = 0;
      }
      if (!part) return;
      let value = part.replace(/([\\`*_[\]<>])/g, "\\$1");
      if (attrs.bold) value = `**${value}**`;
      if (attrs.italic) value = `*${value}*`;
      if (attrs.strike) value = `~~${value}~~`;
      if (attrs.link)
        value = `[${value}](${String(attrs.link).replace(/[()\s]/g, (char) => encodeURIComponent(char))})`;
      current += value;
    });
  }
  return text + current;
}
