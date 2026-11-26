/* Shared helpers. Everything hangs off one global: window.Plato */
(function () {
  'use strict';
  var Plato = window.Plato = { pages: {}, actions: {}, forms: {}, changes: {} };
  var TZ = 'America/New_York';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function fmt(opts) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, opts)); }
  var F_DATE = fmt({ month: 'short', day: 'numeric', year: 'numeric' });
  var F_TIME = fmt({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  var F_MONTH = fmt({ month: 'long', year: 'numeric' });

  var util = Plato.util = {
    PALETTE: ['#d9534f', '#5bc0de', '#5cb85c', '#f0ad4e', '#337ab7', '#9b59b6', '#e67e22', '#1abc9c', '#e83e8c', '#7f8c8d'],
    STATUS: { recommend: 'Recommend', want_to_try: 'Want to try', been: 'Been', avoid: 'Avoid' },

    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); },
    uid: function (prefix) {
      var a = new Uint8Array(5); crypto.getRandomValues(a);
      return prefix + '_' + Array.from(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    },
    /* ISO-8601 with the America/New_York offset, e.g. 2025-03-03T14:05:00-05:00 */
    nowIso: function () {
      var d = new Date();
      var p = {}; fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(d)
        .forEach(function (x) { p[x.type] = x.value; });
      var off = (p.timeZoneName || 'GMT').replace('GMT', '') || '+00:00';
      return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + off;
    },
    valid: function (iso) { return !!iso && !isNaN(new Date(iso)); },
    fmtDate: function (iso) { return util.valid(iso) ? F_DATE.format(new Date(iso)) : ''; },
    fmtDateTime: function (iso) { return util.valid(iso) ? F_TIME.format(new Date(iso)) : ''; },
    monthLabel: function (iso) { return util.valid(iso) ? F_MONTH.format(new Date(iso)) : 'Unknown date'; },
    daysAgo: function (iso) { return util.valid(iso) ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity; },

    slugify: function (s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'list';
    },
    normTag: function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); },
    splitList: function (s) {
      return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    },
    color: function (c, fallback) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : (fallback || '#777777'); },
    textOn: function (hex) {
      var h = util.color(hex).slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&');
      var n = parseInt(h.slice(0, 6), 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170 ? '#333' : '#fff';
    },
    safeUrl: function (u) { return /^https?:\/\//i.test(u || '') ? u : ''; },
    stars: function (n) { n = Number(n) || 0; return n ? '<span class="stars" title="' + n + '/5">' + '★★★★★'.slice(0, n) + '</span>' : ''; },
    price: function (n) { n = Number(n) || 0; return n ? '$$$$'.slice(0, n) : ''; },
    hasPin: function (p) { return typeof p.lat === 'number' && typeof p.lng === 'number'; },
    options: function (pairs, selected) {
      return pairs.map(function (o) {
        return '<option value="' + util.esc(o[0]) + '"' + (String(o[0]) === String(selected == null ? '' : selected) ? ' selected' : '') +
          '>' + util.esc(o[1]) + '</option>';
      }).join('');
    },
    formData: function (form) {
      var out = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name) return;
        if (el.type === 'checkbox') { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
        else if (el.type !== 'radio' || el.checked) out[el.name] = el.value;
      });
      return out;
    },
    /* JSON fetch that always resolves to the body or throws Error(message) */
    api: function (method, url, body) {
      var opts = { method: method, headers: {} };
      if (body instanceof FormData) opts.body = body;
      else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
      return fetch(url, opts).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
          return data;
        });
      });
    }
  };
})();
