/* App shell: page routing, data-act click handling, forms, popup windows, toasts. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util;
  var view = document.getElementById('view');
  var current = { name: null, key: null, page: null };

  function parseHash() {
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    var name = Plato.pages[parts[0]] ? parts[0] : 'map';
    return { name: name, args: parts.slice(1) };
  }
  /* Draw the page for the current hash. A page that is already on screen and
     has update() (the map) is refreshed in place; the rest are redrawn. */
  function show(force) {
    var r = parseHash(), key = r.name + '/' + r.args.join('/'), page = Plato.pages[r.name];
    if (!force && key === current.key && page.update) { page.update(r.args); return; }
    var scroll = key === current.key ? view.scrollTop : 0;
    if (current.page && current.page.unmount) current.page.unmount();
    current = { name: r.name, key: key, page: page };
    view.innerHTML = page.render(r.args);
    if (page.mount) page.mount(r.args);
    view.scrollTop = scroll;
    document.title = (page.title ? page.title + ' · ' : '') + 'Plato the Foodie Philosopher';
    Array.prototype.forEach.call(document.querySelectorAll('#nav-links li'), function (li) {
      li.classList.toggle('active', li.dataset.page === r.name);
    });
  }

  /* One click handler routes every button by its data-act attribute. */
  function onClick(ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var fn = Plato.actions[el.dataset.act];
    if (!fn) { console.warn('No action for', el.dataset.act); return; }
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    fn(el, ev);
  }
  function onSubmit(ev) {
    var form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    var fn = Plato.forms[form.dataset.form];
    if (fn) fn(util.formData(form), form);
  }
  function onChange(attr) {
    return function (ev) {
      var name = ev.target.dataset && ev.target.dataset[attr];
      if (name && Plato.changes[name]) Plato.changes[name](ev.target, ev);
    };
  }

  Plato.modal = {
    open: function (opts) {
      document.getElementById('modal-root').innerHTML =
        '<div class="modal plato-modal" data-act="modal-backdrop"><div class="modal-dialog' + (opts.large ? ' modal-lg' : '') + '">' +
        '<div class="modal-content"><div class="modal-header"><button type="button" class="close" data-act="modal-close">&times;</button>' +
        '<h4 class="modal-title">' + util.esc(opts.title) + '</h4></div><div class="modal-body">' + opts.body + '</div></div></div></div>';
      var first = document.querySelector('#modal-root [autofocus]');
      if (first) first.focus();
    },
    close: function () { document.getElementById('modal-root').innerHTML = ''; },
    isOpen: function () { return !!document.getElementById('modal-root').firstChild; }
  };
  Plato.actions['modal-close'] = Plato.modal.close;
  Plato.actions['modal-backdrop'] = function (el, ev) { if (ev.target === el) Plato.modal.close(); };

  Plato.toast = function (message, kind) {
    var el = document.createElement('div');
    el.innerHTML = '<span class="toast ' + (kind || '') + '">' + util.esc(message) + '</span>';
    document.getElementById('toast-root').appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'error' ? 6000 : 2800);
  };

  Plato.app = {
    onClick: onClick,
    refresh: function () { show(false); },
    redraw: function () { show(true); },
    current: function () { return current.name; }
  };

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange('change'));
  document.addEventListener('input', onChange('input'));
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && Plato.modal.isOpen()) Plato.modal.close(); });
  window.addEventListener('hashchange', function () { show(false); });
  window.addEventListener('error', function (ev) { Plato.toast('Something went wrong: ' + ev.message, 'error'); });

  Plato.store.subscribe(function () { show(false); });
  Plato.store.load().then(function () {
    Plato.store.setMode(Plato.store.mode);
    show(true);
    return util.api('GET', '/api/config').then(function (cfg) { Plato.ask.enable(!!cfg.ai); }).catch(function () {});
  });
})();
