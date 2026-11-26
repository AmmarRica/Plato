/* Lists page: cards, create/edit/delete/reorder, detail with a small map, sharing. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, db = Plato.db, store = Plato.store, esc = util.esc;
  var mini = null;

  function lastAdded(listId) { var items = db.itemsOfList(listId); return items.length ? items[0].added_at : null; }

  function cardHtml(l, i, all) {
    var count = db.itemsOfList(l.id).length, last = lastAdded(l.id);
    var btn = function (act, label, extra) {
      return '<button class="btn btn-default btn-xs" data-act="' + act + '" data-id="' + l.id + '"' + (extra || '') + '>' + label + '</button>';
    };
    return '<div class="list-card" style="--c:' + util.color(l.color) + '"><h4><a href="#/lists/' + l.id + '">' + esc(l.name) + '</a> ' +
      (l.is_shared ? '<span class="label label-success">shared</span>' : '') + '</h4>' +
      (l.description ? '<p>' + esc(l.description) + '</p>' : '') +
      '<div class="muted">' + count + (count === 1 ? ' place' : ' places') + (last ? ' · last added ' + esc(util.fmtDate(last)) : '') + '</div>' +
      '<div class="btn-row">' + btn('list-edit', 'Edit') + btn('list-share', 'Share') +
      btn('list-move', '↑', ' data-dir="-1" title="Move up"' + (i === 0 ? ' disabled' : '')) +
      btn('list-move', '↓', ' data-dir="1" title="Move down"' + (i === all.length - 1 ? ' disabled' : '')) +
      btn('list-delete', 'Delete') + '</div></div>';
  }
  function indexHtml() {
    var lists = store.data.lists;
    return '<div class="page container"><div class="page-head"><h2>Lists</h2>' +
      '<button class="btn btn-success" data-act="list-new">+ New list</button></div>' +
      (lists.length ? '<div class="list-cards">' + lists.map(cardHtml).join('') + '</div>'
        : '<p class="muted">No lists yet. Create one, then add places to it from the map.</p>') + '</div>';
  }
  function detailHtml(l) {
    var rows = db.itemsOfList(l.id).map(function (item) {
      var p = db.place(item.place_id); if (!p) return '';
      return '<tr><td><a data-act="place-focus" data-id="' + p.id + '" role="button"><b>' + esc(p.name) + '</b></a>' +
        (util.hasPin(p) ? '' : ' <span class="label label-warning">needs pin</span>') + '<div>' + Plato.places.chips(p.tags) + '</div>' +
        (item.note ? '<div><em>' + esc(item.note) + '</em></div>' : '') + '</td>' +
        '<td>' + Plato.places.meta(p) + '</td>' +
        '<td title="' + esc(util.fmtDateTime(item.added_at)) + '">' + esc(util.fmtDate(item.added_at)) +
        (item.added_at_estimated ? ' <span class="muted" title="No saved date in the import; this is the import time">(est.)</span>' : '') + '</td>' +
        '<td class="text-right" style="white-space:nowrap"><button class="btn btn-default btn-xs" data-act="item-note" data-id="' + p.id + '" data-list="' + l.id + '">Note</button> ' +
        '<button class="btn btn-default btn-xs" data-act="place-edit" data-id="' + p.id + '">Edit</button> ' +
        '<button class="btn btn-default btn-xs" data-act="item-remove" data-id="' + p.id + '" data-list="' + l.id + '">Remove</button></td></tr>';
    }).join('');
    return '<div class="page container"><div class="page-head"><h2><span class="swatch" style="background:' + util.color(l.color) + '"></span>' +
      esc(l.name) + (l.is_shared ? ' <span class="label label-success">shared</span>' : '') + '</h2>' +
      '<a class="btn btn-default" href="#/lists">← All lists</a>' +
      '<button class="btn btn-default" data-act="list-on-map" data-id="' + l.id + '">Open on main map</button>' +
      '<button class="btn btn-default" data-act="list-edit" data-id="' + l.id + '">Edit</button>' +
      '<button class="btn btn-primary" data-act="list-share" data-id="' + l.id + '">Share</button>' +
      (l.is_shared ? '<button class="btn btn-default" data-act="list-unshare" data-id="' + l.id + '">Stop sharing</button>' : '') + '</div>' +
      (l.description ? '<p>' + esc(l.description) + '</p>' : '') + '<div id="mini-map"></div>' +
      (rows ? '<table class="table"><thead><tr><th>Place</th><th></th><th>Added</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="muted">No places on this list yet. Open a place on the map and choose “Add to list”.</p>') + '</div>';
  }
  function openForm(l) {
    l = l || { color: util.PALETTE[store.data.lists.length % util.PALETTE.length] };
    Plato.modal.open({ title: l.id ? 'Edit list' : 'New list', body:
      '<form data-form="list"><input type="hidden" name="id" value="' + esc(l.id || '') + '">' +
      '<div class="form-group"><label>Name</label><input class="form-control" name="name" value="' + esc(l.name || '') + '" required autofocus placeholder="Best Coffee in Philly"></div>' +
      '<div class="form-group"><label>Description</label><textarea class="form-control" name="description" rows="2">' + esc(l.description || '') + '</textarea></div>' +
      '<div class="row"><div class="col-xs-4"><div class="form-group"><label>Color</label><input class="form-control" type="color" name="color" value="' + esc(util.color(l.color)) + '"></div></div>' +
      '<div class="col-xs-8"><div class="form-group"><label>Share address: /s/…</label><input class="form-control" name="share_slug" value="' + esc(l.share_slug || '') +
      '" pattern="[a-z0-9][a-z0-9-]*" placeholder="made from the name"></div></div></div>' +
      '<div class="text-right"><button type="button" class="btn btn-default" data-act="modal-close">Cancel</button> <button class="btn btn-primary">Save</button></div></form>' });
  }

  Plato.lists = {
    make: function (name) {
      return { id: util.uid('ls'), name: name.trim(), description: '', is_shared: false, created_at: util.nowIso(),
        color: util.PALETTE[store.data.lists.length % util.PALETTE.length], share_slug: db.uniqueSlug(name) };
    }
  };

  Plato.pages.lists = {
    title: 'Lists',
    render: function (args) {
      var l = args[0] && db.list(args[0]);
      return l ? detailHtml(l) : indexHtml();
    },
    mount: function (args) {
      var l = args[0] && db.list(args[0]);
      if (!l || !document.getElementById('mini-map')) return;
      var s = store.data.settings, pts = [];
      mini = L.map('mini-map').setView([s.home_lat, s.home_lng], s.default_zoom);
      L.tileLayer(Plato.map.tiles, { maxZoom: 19, attribution: Plato.map.attribution }).addTo(mini);
      Plato.basemap.addTo(mini);
      db.itemsOfList(l.id).forEach(function (item) {
        var p = db.place(item.place_id); if (!p || !util.hasPin(p)) return;
        var tag = db.tag((p.tags || [])[0]) || {};
        L.marker([p.lat, p.lng], { icon: Plato.map.pinIcon(l.color, tag.icon), title: p.name }).addTo(mini)
          .bindPopup('<b>' + esc(p.name) + '</b><br>added ' + esc(util.fmtDate(item.added_at)));
        pts.push([p.lat, p.lng]);
      });
      if (pts.length) mini.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    },
    unmount: function () { if (mini) { mini.remove(); mini = null; } }
  };

  Plato.forms.list = function (data) {
    store.commit(function (d) {
      var l = data.id ? db.list(data.id) : Plato.lists.make(data.name);
      if (!l) return;
      Object.assign(l, { name: data.name.trim(), description: data.description.trim(), color: util.color(data.color) });
      l.share_slug = db.uniqueSlug(data.share_slug || l.share_slug || data.name, l.id);
      if (!data.id) d.lists.push(l);
    });
    Plato.modal.close();
    Plato.toast('List saved', 'success');
  };

  Object.assign(Plato.actions, {
    'list-new': function () { openForm(null); },
    'list-edit': function (el) { openForm(db.list(el.dataset.id)); },
    'list-delete': function (el) {
      var l = db.list(el.dataset.id);
      if (!l || !confirm('Delete the list "' + l.name + '"? Its places stay on the map.')) return;
      store.commit(function () { db.removeList(l.id); });
    },
    'list-move': function (el) {
      store.commit(function (d) {
        var i = d.lists.findIndex(function (l) { return l.id === el.dataset.id; }), j = i + Number(el.dataset.dir);
        if (i < 0 || j < 0 || j >= d.lists.length) return;
        d.lists.splice(j, 0, d.lists.splice(i, 1)[0]);
      });
    },
    'list-on-map': function (el) { Plato.map.showList(el.dataset.id); },
    'item-remove': function (el) { store.commit(function () { db.removeFromList(el.dataset.list, el.dataset.id); }); },
    'item-note': function (el) {
      var item = db.item(el.dataset.list, el.dataset.id); if (!item) return;
      var note = prompt('Note for this place on this list (shown on the shared map):', item.note || '');
      if (note !== null) store.commit(function () { item.note = note.trim(); });
    },
    'list-unshare': function (el) {
      store.commit(function () { var l = db.list(el.dataset.id); if (l) l.is_shared = false; });
      Plato.toast('Sharing stopped. Delete the exported file yourself if you sent it.');
    },
    /* Marks the list shared, serves /s/<slug>, and writes exports/<slug>.html */
    'list-share': function (el) {
      if (store.mode !== 'server') { Plato.toast('Sharing needs the Plato server running', 'error'); return; }
      store.flush().then(function () { return util.api('POST', '/api/share/' + encodeURIComponent(el.dataset.id)); })
        .then(function (res) {
          store.adopt(res.data);
          var url = location.origin + res.url;
          Plato.modal.open({ title: 'List shared', body:
            '<p><b>Read-only page</b> (works while this server is running):<br><a href="' + esc(res.url) + '" target="_blank">' + esc(url) + '</a></p>' +
            '<p><b>Self-contained file</b> to send or host anywhere:<br><code>' + esc(res.path) + '</code> ' +
            '<a class="btn btn-default btn-xs" href="' + esc(res.download) + '" download>Download</a></p>' +
            '<p class="muted">Only public fields are included. Private notes never leave Plato. Click Share again after changes to refresh the file.</p>' +
            '<div class="text-right"><button class="btn btn-primary" data-act="modal-close">Done</button></div>' });
        }).catch(function (err) { Plato.toast('Share failed: ' + err.message, 'error'); });
    }
  });
})();
