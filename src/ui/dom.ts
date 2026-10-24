// A tiny element builder for the menus and party screens.
type Attrs = Record<string, string | boolean | number | ((e: Event) => void)>;

/** h('button', { class: 'btn', onclick: f }, 'Text'): `on…` attributes are listeners, `true` adds a bare attribute */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null, ...kids: (Node | string | null | false)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (typeof v === 'boolean') { if (v) e.setAttribute(k, ''); }
    else e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}
