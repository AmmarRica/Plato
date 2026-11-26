/* Places: chips, popup, filtering, the add/edit form and "Add to list". */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, db = Plato.db, store = Plato.store, esc = util.esc;

  var places = Plato.places = {
    chip: function (name, extra) {
      var t = db.tag(name) || {}, bg = util.color(t.color);
      return '<span class="tag-chip" style="background:' + bg + ';color:' + util.textOn(bg) + '"' + (extra || '') + '>' +
        esc((t.icon ? t.icon + ' ' : '') + name) + '</span>';
    },
    chips: function (tags) { return (tags || []).map(function (n) { return places.chip(n); }).join(''); },

    /* When was this place last added to a list (to one list, or to any)? */
    lastAdded: function (p, listId) {
      var dates = db.itemsOfPlace(p.id).filter(function (i) { return !listId || i.list_id === listId; })
        .map(function (i) { return i.added_at; }).filter(util.valid).sort();
      return dates.length ? dates[dates.length - 1] : (listId ? null : p.created_at);
    },
    /* f = {list, tags[], status, price, days, q}; selected tags must all match. */
    filter: function (f) {
      var q = (f.q || '').trim().toLowerCase(), days = Number(f.days) || 0;
      return store.data.places.filter(function (p) {
        if (f.list && !db.item(f.list, p.id)) return false;
        if ((f.tags || []).some(function (t) { return (p.tags || []).indexOf(t) < 0; })) return false;
        if (f.status && p.status !== f.status) return false;
        if (f.price && String(p.price || '') !== String(f.price)) return false;
        if (days && util.daysAgo(places.lastAdded(p, f.list)) > days) return false;
        if (q && [p.name, p.address, (p.tags || []).join(' '), p.notes_public, (p.must_order || []).join(' ')]
          .join(' ').toLowerCase().indexOf(q) < 0) return false;
        return true;
      }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    },
    meta: function (p) {
      return [util.stars(p.rating), esc(util.price(p.price)),
        p.status && p.status !== 'recommend' ? esc(util.STATUS[p.status] || p.status) : '']
        .filter(Boolean).join(' · ');
    },
    popupHtml: function (p) {
      var url = util.safeUrl(p.google_maps_url) ||
        (util.hasPin(p) ? 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng : '');
      var h = '<div class="popup"><h4>' + esc(p.name) + '</h4>' + places.chips(p.tags);
      if (places.meta(p)) h += '<div class="row-gap">' + places.meta(p) + '</div>';
      if (p.notes_public) h += '<div class="row-gap">' + esc(p.notes_public) + '</div>';
      if ((p.must_order || []).length) h += '<div class="row-gap"><b>Must order:</b> ' + esc(p.must_order.join(', ')) + '</div>';
      if (p.address) h += '<div class="row-gap muted">' + esc(p.address) + '</div>';
      h += '<div class="row-gap">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Google Maps ↗</a> ' : '') + '</div>';
      h += '<div class="row-gap"><button class="btn btn-primary btn-xs" data-act="place-lists" data-id="' + p.id + '">+ Add to list</button> ' +
        '<button class="btn btn-default btn-xs" data-act="place-edit" data-id="' + p.id + '">Edit</button></div></div>';
      return h;
    },
    rowHtml: function (p) {
      return '<div class="place-row" data-act="place-focus" data-id="' + p.id + '"><div class="name">' + esc(p.name) +
        (util.hasPin(p) ? '' : ' <span class="label label-warning">needs pin</span>') + '</div>' +
        '<div>' + places.chips(p.tags) + '</div><div class="sub">' + places.meta(p) + '</div></div>';
    },

    /* place = existing place to edit, or null with a draft {name,address,lat,lng} for a new one */
    openForm: function (place, draft) {
      var p = place || Object.assign({ status: 'recommend', tags: [], must_order: [] }, draft || {});
      var field = function (label, html) { return '<div class="form-group"><label>' + label + '</label>' + html + '</div>'; };
      var text = function (name, value, more) {
        return '<input class="form-control" name="' + name + '" value="' + esc(value == null ? '' : value) + '" ' + (more || '') + '>';
      };
      var listBoxes = store.data.lists.map(function (l) {
        var on = place ? !!db.item(l.id, place.id) : false;
        return '<label class="checkbox-inline"><input type="checkbox" name="lists" value="' + l.id + '"' + (on ? ' checked' : '') + '> ' +
          '<span class="swatch" style="background:' + util.color(l.color) + '"></span>' + esc(l.name) + '</label>';
      }).join(' ') || '<span class="muted">No lists yet. Create one on the Lists page.</span>';
      var tagPicks = store.data.tags.map(function (t) {
        return places.chip(t.name, ' data-act="tag-pick" data-tag="' + esc(t.name) + '" role="button"');
      }).join('');
      Plato.modal.open({
        title: place ? 'Edit place' : 'Add place',
        body: '<form data-form="place"><input type="hidden" name="id" value="' + esc(p.id || '') + '">' +
          field('Name', text('name', p.name, 'required autofocus')) +
          field('Address', text('address', p.address)) +
          '<div class="row"><div class="col-xs-4">' + field('Latitude', text('lat', p.lat, 'type="number" step="any"')) + '</div>' +
          '<div class="col-xs-4">' + field('Longitude', text('lng', p.lng, 'type="number" step="any"')) + '</div>' +
          '<div class="col-xs-4">' + field('&nbsp;', place ? '<button type="button" class="btn btn-default btn-block" data-act="place-repin" data-id="' + p.id + '">Move pin</button>' : '<p class="form-control-static muted">from the map</p>') + '</div></div>' +
          field('Tags (comma separated)', text('tags', (p.tags || []).join(', '), 'id="place-tags" placeholder="korean, bbq"') +
            '<div style="margin-top:5px">' + tagPicks + '</div>') +
          '<div class="row"><div class="col-xs-4">' + field('Status', '<select class="form-control" name="status">' +
            util.options(Object.keys(util.STATUS).map(function (k) { return [k, util.STATUS[k]]; }), p.status) + '</select>') + '</div>' +
          '<div class="col-xs-4">' + field('Price', '<select class="form-control" name="price">' +
            util.options([['', '—'], [1, '$'], [2, '$$'], [3, '$$$'], [4, '$$$$']], p.price) + '</select>') + '</div>' +
          '<div class="col-xs-4">' + field('Rating', '<select class="form-control" name="rating">' +
            util.options([['', '—'], [5, '★★★★★'], [4, '★★★★'], [3, '★★★'], [2, '★★'], [1, '★']], p.rating) + '</select>') + '</div></div>' +
          field('Must order (comma separated)', text('must_order', (p.must_order || []).join(', '), 'placeholder="galbi, japchae"')) +
          field('Public note (shown on shared maps)', '<textarea class="form-control" name="notes_public" rows="2">' + esc(p.notes_public) + '</textarea>') +
          field('Private note (never shared)', '<textarea class="form-control" name="notes_private" rows="2">' + esc(p.notes_private) + '</textarea>') +
          field('Google Maps link', text('google_maps_url', p.google_maps_url, 'type="url" placeholder="https://maps.app.goo.gl/..."')) +
          field('Lists', '<div>' + listBoxes + '</div>') +
          '<div class="text-right">' + (place ? '<button type="button" class="btn btn-danger pull-left" data-act="place-delete" data-id="' + p.id + '">Delete</button>' : '') +
          '<button type="button" class="btn btn-default" data-act="modal-close">Cancel</button> ' +
          '<button type="submit" class="btn btn-primary">Save</button></div></form>'
      });
    },

    openLists: function (id) {
      var p = db.place(id); if (!p) return;
      var rows = store.data.lists.map(function (l) {
        var item = db.item(l.id, id);
        return '<tr><td><span class="swatch" style="background:' + util.color(l.color) + '"></span>' + esc(l.name) + '</td>' +
          '<td class="muted">' + (item ? 'added ' + esc(util.fmtDate(item.added_at)) : '') + '</td>' +
          '<td class="text-right"><button class="btn btn-xs ' + (item ? 'btn-default' : 'btn-primary') + '" data-act="place-list-toggle" data-id="' + id +
          '" data-list="' + l.id + '">' + (item ? 'Remove' : '+ Add') + '</button></td></tr>';
      }).join('');
      Plato.modal.open({
        title: 'Lists for ' + p.name,
        body: (rows ? '<table class="table table-condensed">' + rows + '</table>' : '<p class="muted">No lists yet.</p>') +
          '<form class="form-inline" data-form="quick-list"><input type="hidden" name="place" value="' + id + '">' +
          '<input class="form-control input-sm" name="name" placeholder="New list name" required> ' +
          '<button class="btn btn-default btn-sm">Create and add</button></form>'
      });
    }
  };

  var num = function (v) { return v === '' || v == null || isNaN(Number(v)) ? null : Number(v); };

  Plato.forms.place = function (data) {
    var isNew = !data.id, id = data.id || util.uid('pl'), now = util.nowIso();
    store.commit(function (d) {
      var p = isNew ? { id: id, google_place_id: '', source: 'manual', created_at: now } : db.place(id);
      if (!p) return;
      Object.assign(p, {
        name: data.name.trim(), address: data.address.trim(), lat: num(data.lat), lng: num(data.lng),
        google_maps_url: data.google_maps_url.trim(), tags: util.splitList(data.tags).map(util.normTag),
        price: num(data.price), rating: num(data.rating), status: data.status,
        notes_public: data.notes_public.trim(), notes_private: data.notes_private.trim(),
        must_order: util.splitList(data.must_order), updated_at: now
      });
      if (util.hasPin(p)) delete p.needs_pin;
      if (isNew) d.places.push(p);
      d.lists.forEach(function (l) {
        if ((data.lists || []).indexOf(l.id) >= 0) db.addToList(l.id, id); else db.removeFromList(l.id, id);
      });
    });
    Plato.modal.close();
    Plato.toast(isNew ? 'Place added' : 'Place saved', 'success');
    Plato.map.placeSaved(id, isNew);
  };

  Plato.forms['quick-list'] = function (data) {
    store.commit(function (d) {
      var l = Plato.lists.make(data.name);
      d.lists.push(l);
      db.addToList(l.id, data.place);
    });
    places.openLists(data.place);
  };

  Object.assign(Plato.actions, {
    'place-edit': function (el) { var p = db.place(el.dataset.id); if (p) places.openForm(p); },
    'place-delete': function (el) {
      var p = db.place(el.dataset.id);
      if (!p || !confirm('Delete "' + p.name + '" and remove it from every list?')) return;
      Plato.modal.close();
      store.commit(function () { db.removePlace(p.id); });
      Plato.toast('Place deleted');
    },
    'place-lists': function (el) { places.openLists(el.dataset.id); },
    'place-list-toggle': function (el) {
      var id = el.dataset.id, listId = el.dataset.list;
      store.commit(function () {
        if (db.item(listId, id)) db.removeFromList(listId, id); else db.addToList(listId, id);
      });
      places.openLists(id);
    },
    'place-focus': function (el) { Plato.map.focus(el.dataset.id); },
    'place-repin': function (el) { Plato.modal.close(); Plato.map.startPick({ kind: 'repin', id: el.dataset.id }); },
    'tag-pick': function (el) {
      var input = document.getElementById('place-tags'); if (!input) return;
      var tags = util.splitList(input.value).map(util.normTag), i = tags.indexOf(el.dataset.tag);
      if (i >= 0) tags.splice(i, 1); else tags.push(el.dataset.tag);
      input.value = tags.join(', ');
    }
  });
})();
