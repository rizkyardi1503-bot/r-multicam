// Indonesian UI translator for text that site scripts render at runtime.
// Loaded only on /id/ pages. The dictionary is injected by scripts/build-site.py.
'use strict';
(() => {
  const DICT = __DICT__;
  const text = DICT.text || {};
  const patterns = (DICT.patterns || []).map(([src, rep]) => [new RegExp(src, 'u'), rep]);
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
  const done = new WeakMap();

  function translate(value) {
    const trimmed = value.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
    let out = Object.prototype.hasOwnProperty.call(text, trimmed) ? text[trimmed] : null;
    if (out === null) {
      for (const [re, rep] of patterns) {
        if (re.test(trimmed)) { out = trimmed.replace(re, rep); break; }
      }
    }
    if (out === null || out === trimmed) return null;
    const lead = value.match(/^\s*/)[0];
    const trail = value.match(/\s*$/)[0];
    return lead + out + trail;
  }

  function textNode(node) {
    if (done.get(node) === node.data) return;
    const p = node.parentNode;
    if (!p || SKIP.has(p.nodeName) || (p.closest && p.closest('[data-no-translate]'))) return;
    const next = translate(node.data);
    if (next !== null) node.data = next;
    done.set(node, node.data);
  }

  function element(el) {
    if (SKIP.has(el.nodeName)) return;
    for (const name of ATTRS) {
      const v = el.getAttribute && el.getAttribute(name);
      if (v) { const next = translate(v); if (next !== null) el.setAttribute(name, next); }
    }
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      const next = translate(el.value); if (next !== null) el.value = next;
    }
  }

  function walk(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) element(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) textNode(n); else element(n);
    }
  }

  function start() {
    walk(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') textNode(r.target);
        else if (r.type === 'attributes') element(r.target);
        else r.addedNodes.forEach(walk);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.RP_I18N = { lang: 'id', translate: (s) => translate(s) ?? s };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
