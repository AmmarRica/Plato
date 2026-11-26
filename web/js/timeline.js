/* Timeline page: every list addition, newest first, under month headers. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, db = Plato.db, store = Plato.store, esc = util.esc;
  var listFilter = '';

  Plato.pages.timeline = {
    title: 'Timeline',
    render: function () {
      var items = store.data.list_items.filter(function (i) { return !listFilter || i.list_id === listFilter; })
        .sort(function (a, b) { return new Date(b.added_at) - new Date(a.added_at); });
      var month = null, html = '';
      items.forEach(function (item) {
        var p = db.place(item.place_id), l = db.list(item.list_id);
        if (!p || !l) return;
        var label = util.monthLabel(item.added_at);
        if (label !== month) { month = label; html += '<h3 class="timeline-month">' + esc(label) + '</h3>'; }
        html += '<div class="timeline-item" style="--c:' + util.color(l.color) + '">Added <a data-act="place-focus" data-id="' + p.id + '" role="button"><b>' +
          esc(p.name) + '</b></a> to <a href="#/lists/' + l.id + '">' + esc(l.name) + '</a> · <span class="muted" title="' +
          esc(util.fmtDateTime(item.added_at)) + '">' + esc(util.fmtDate(item.added_at)) + (item.added_at_estimated ? ' (est.)' : '') + '</span></div>';
      });
      return '<div class="page container"><div class="page-head"><h2>Timeline</h2>' +
        '<select class="form-control" style="width:auto" data-change="timeline-list">' +
        util.options([['', 'All lists']].concat(store.data.lists.map(function (l) { return [l.id, l.name]; })), listFilter) + '</select></div>' +
        (html || '<p class="muted">Nothing yet. Each time a place is added to a list it shows up here with its date.</p>') +
        '<p class="muted" style="margin-top:20px">Dates are shown in America/New_York. “(est.)” means the import had no saved date, so the import time was used.</p></div>';
    }
  };
  Plato.changes['timeline-list'] = function (el) { listFilter = el.value; Plato.app.redraw(); };
})();
