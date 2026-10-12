(function () {
  try {
    var doc = document, root = doc.documentElement;
    var m = /(?:^|;\s*)octopus_prefs=([^;]*)/.exec(doc.cookie || '');
    if (!m) return;
    var p = JSON.parse(decodeURIComponent(m[1]));
    if (!p || typeof p !== 'object' || p.v !== 1) return;

    var mode = p.mode;
    if (mode === 'dark' || mode === 'light' || mode === 'system') {
      try { root.setAttribute('data-theme', mode); } catch (e) {}
    } else { mode = null; }

    var d = p.density;
    if (d === 'comfortable' || d === 'compact') {
      try { root.setAttribute('data-density', d); } catch (e) {}
    }

    var a = p.accent;
    if (typeof a === 'string' && /^#[0-9a-fA-F]{6}$/.test(a)) {
      try {
        var c = [1, 3, 5].map(function (i) { return parseInt(a.slice(i, i + 2), 16); });
        var lum = function (rgb) {
          var l = rgb.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
        };
        var light = mode === 'light' ||
          (mode !== 'dark' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches);
        // Hover: lighten on dark, darken on light, by mixing 18% toward white/black.
        var t = light ? 0 : 255, k = 0.18;
        var hov = c.map(function (v) { return Math.round(v + (t - v) * k); });
        var hex = function (rgb) { return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); };
        // Ink: near-black or white, whichever contrasts more with the accent.
        var L = lum(c);
        var ink = (L + 0.05) / (0.004 + 0.05) >= (1.05) / (L + 0.05) ? '#0b0d10' : '#ffffff';
        var s = root.style;
        s.setProperty('--o-accent', a.toLowerCase());
        s.setProperty('--o-accent-hover', hex(hov));
        s.setProperty('--o-accent-ink', ink);
      } catch (e) {}
    }
  } catch (e) {}
})();
