// @ts-nocheck
// Patch an element's children to match new HTML, keeping existing nodes where
// the tag matches. Real-time fight panels re-render every second; replacing
// innerHTML would drop taps that land mid-render and restart every animation.

function sameKind(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName
    && (a.nodeType !== 1 || (a.getAttribute('data-key') || '') === (b.getAttribute('data-key') || ''));
}

function patchAttributes(from, to) {
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
}

function patchChildren(from, to) {
  const next = [...to.childNodes];
  let current = from.firstChild;
  for (const target of next) {
    if (current && sameKind(current, target)) {
      if (current.nodeType === 1) {
        patchAttributes(current, target);
        patchChildren(current, target);
      } else if (current.nodeValue !== target.nodeValue) current.nodeValue = target.nodeValue;
      current = current.nextSibling;
    } else {
      from.insertBefore(target, current);
    }
  }
  while (current) {
    const after = current.nextSibling;
    from.removeChild(current);
    current = after;
  }
}

export function morphInto(el, html) {
  if (!el) return;
  if (el._wcMorphHtml === html) return;
  el._wcMorphHtml = html;
  const template = el.ownerDocument.createElement('template');
  template.innerHTML = html;
  patchChildren(el, template.content);
}
