// PostCSS plugin used by every interface build (desktop, dev server and Android). Touch screens keep
// ":hover" applied to the last tapped element, so a hover colour would override the colour of the
// active/selected state it was tapped into (white text on a purple tab turning grey). Rules with
// ":hover" therefore apply only where the device really hovers: unchanged with a mouse.
export function hoverMedia() {
  return {
    postcssPlugin: 'gcp-hover-media',
    Once(root, {AtRule}) {
      root.walkRules((rule) => {
        if (!rule.selector.includes(':hover')) return;
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'media' && rule.parent.params.includes('hover')) return;
        if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
        const parts = rule.selectors, hover = parts.filter((s) => s.includes(':hover')), rest = parts.filter((s) => !s.includes(':hover'));
        const wrapped = rule.clone({selectors: hover});
        const media = new AtRule({name: 'media', params: '(hover: hover)'});
        media.append(wrapped);
        rule.after(media);
        if (rest.length) rule.selectors = rest; else rule.remove();
      });
    },
  };
}
hoverMedia.postcss = true;
