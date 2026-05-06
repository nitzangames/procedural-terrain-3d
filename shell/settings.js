const KEY = 'terrain.style';

export function buildSettings({ parent, initialStyle, onStyleChange }) {
  const root = document.createElement('div');
  root.style.cssText = `
    position:fixed; right:8px; bottom:8px; pointer-events:auto;
    font-family:ui-monospace,Menlo,monospace; color:#fff; font-size:13px;
  `;
  root.innerHTML = `
    <button id="set-toggle" style="background:rgba(0,0,0,.55);border:1px solid #fff4;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">Style: ${initialStyle}</button>
    <div id="set-panel" style="display:none;margin-top:6px;background:rgba(0,0,0,.7);border:1px solid #fff4;border-radius:8px;padding:6px;min-width:140px">
      <button data-style="lowpoly" class="set-btn">Low-poly</button>
      <button data-style="stylized" class="set-btn">Stylized</button>
      <button data-style="realistic" class="set-btn">Realistic</button>
      <button data-style="cartograph" class="set-btn">Cartograph</button>
    </div>
  `;
  parent.appendChild(root);
  const toggle = root.querySelector('#set-toggle');
  const panel  = root.querySelector('#set-panel');
  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  for (const btn of root.querySelectorAll('.set-btn')) {
    btn.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:0;color:#fff;padding:6px 8px;cursor:pointer;font:inherit';
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,.12)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    btn.addEventListener('click', () => {
      const s = btn.dataset.style;
      localStorage.setItem(KEY, s);
      toggle.textContent = 'Style: ' + s;
      panel.style.display = 'none';
      onStyleChange(s);
    });
  }
  return {
    getStoredStyle() { return localStorage.getItem(KEY); },
    dispose() { parent.removeChild(root); },
  };
}
