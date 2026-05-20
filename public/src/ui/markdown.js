export function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatInlineMarkdown(value) {
  return escapeHTML(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function markdownToPlainText(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-z]*|```/gi, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = null;
  let codeOpen = false;
  let codeLines = [];

  function closeList() {
    if (listType) {
      html.push("</" + listType + ">");
      listType = null;
    }
  }

  function closeCode() {
    if (!codeOpen) return;
    html.push("<pre><code>" + escapeHTML(codeLines.join("\n")) + "</code></pre>");
    codeOpen = false;
    codeLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      closeList();
      if (codeOpen) closeCode();
      else codeOpen = true;
      continue;
    }
    if (codeOpen) {
      codeLines.push(line);
      continue;
    }
    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(4, Math.max(3, heading[1].length + 2));
      html.push("<h" + level + ">" + formatInlineMarkdown(heading[2]) + "</h" + level + ">");
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      closeList();
      html.push("<blockquote>" + formatInlineMarkdown(quote[1]) + "</blockquote>");
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push("<li>" + formatInlineMarkdown(ordered[1]) + "</li>");
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push("<li>" + formatInlineMarkdown(bullet[1]) + "</li>");
      continue;
    }

    closeList();
    html.push("<p>" + formatInlineMarkdown(trimmed) + "</p>");
  }
  closeCode();
  closeList();
  return html.join("");
}
