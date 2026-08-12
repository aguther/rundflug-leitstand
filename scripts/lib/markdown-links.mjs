export function replaceMarkdownLinks(markdown, replacement) {
  let output = "";
  let consumedUntil = 0;
  let searchFrom = 0;

  while (searchFrom < markdown.length) {
    const openingBracket = markdown.indexOf("[", searchFrom);
    if (openingBracket < 0) break;
    const image = openingBracket > 0 && markdown[openingBracket - 1] === "!";
    const matchStart = image ? openingBracket - 1 : openingBracket;
    if (matchStart < consumedUntil) {
      searchFrom = openingBracket + 1;
      continue;
    }
    const labelEnd = markdown.indexOf("](", openingBracket + 1);
    if (labelEnd < 0) break;
    const targetStart = labelEnd + 2;
    const targetEnd = markdown.indexOf(")", targetStart);
    if (targetEnd < 0) break;
    if (targetEnd === targetStart) {
      searchFrom = openingBracket + 1;
      continue;
    }

    const match = {
      image,
      label: markdown.slice(openingBracket + 1, labelEnd),
      raw: markdown.slice(matchStart, targetEnd + 1),
      target: markdown.slice(targetStart, targetEnd),
    };
    output += markdown.slice(consumedUntil, matchStart);
    output += replacement(match);
    consumedUntil = targetEnd + 1;
    searchFrom = consumedUntil;
  }

  return output + markdown.slice(consumedUntil);
}

export function markdownLinkTargets(markdown) {
  const targets = [];
  replaceMarkdownLinks(markdown, (match) => {
    targets.push(match.target);
    return match.raw;
  });
  return targets;
}
