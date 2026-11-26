/* Map page (home): Leaflet map, side panel with filters, add-place flow, settings. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, db = Plato.db, store = Plato.store, esc = util.esc;
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var noFilters = function () { return { list: '', tags: [], status: '', price: '', days: '', q: '' }; };
  var state = { filters: noFilters(), panelOpen: window.innerWidth > 700, pick: null, adding: false, results: null,
    searching: false, view: null, focusId: null };
  var map = null, cluster = null, markers = {}, temp = null;

  function pinIcon(color, emoji, cls) {
    return L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26],
      html: '<div class="pin ' + (cls || '') + '" style="--c:' + util.color(color, '#337ab7') + '"><span>' + esc(emoji || '') + '</span></div>' });
  }
  /* Colored by the selected list, or by first tag when "All places" is selected. */
  function iconFor(p) {
    var tag = db.tag((p.tags || [])[0]) || {}, list = db.list(state.filters.list);
    return pinIcon(list ? list.color : tag.color, tag.icon, p.status === 'avoid' ? 'avoid' : '');
  }

  function filtersHtml() {
    var f = state.filters, d = store.data;
    var chips = d.tags.map(function (t) {
      var on = f.tags.indexOf(t.name) >= 0, bg = util.color(t.color);
      return '<button class="tag-chip' + (on ? '' : ' off') + '" style="background:' + bg + ';color:' + util.textOn(bg) +
        '" data-act="filter-tag" data-tag="' + esc(t.name) + '">' + esc((t.icon ? t.icon + ' ' : '') + t.name) + '</button>';
    }).join('') || '<span class="muted">Tags appear here once places have them.</span>';
    return '<div class="filter-block"><input class="form-control input-sm" placeholder="Search places" value="' + esc(f.q) + '" data-input="filter-q"></div>' +
      '<div class="filter-block"><label>List</label><select class="form-control input-sm" data-change="filter" data-key="list">' +
      util.options([['', 'All places']].concat(d.lists.map(function (l) { return [l.id, l.name]; })), f.list) + '</select></div>' +
      '<div class="filter-block"><label>Tags</label>' + chips + '</div>' +
      '<div class="filter-block filter-row"><div><label>Status</label><select class="form-control input-sm" data-change="filter" data-key="status">' +
      util.options([['', 'Any']].concat(Object.keys(util.STATUS).map(function (k) { return [k, util.STATUS[k]]; })), f.status) + '</select></div>' +
      '<div><label>Price</label><select class="form-control input-sm" data-change="filter" data-key="price">' +
      util.options([['', 'Any'], [1, '$'], [2, '$$'], [3, '$$$'], [4, '$$$$']], f.price) + '</select></div>' +
      '<div><label>Added, last N days</label><input type="number" min="1" class="form-control input-sm" placeholder="any" value="' + esc(f.days) +
      '" data-change="filter" data-key="days"></div></div>';
  }
  function listHtml() {
    var shown = Plato.places.filter(state.filters), total = store.data.places.length;
    var unpinned = store.data.places.filter(function (p) { return !util.hasPin(p); }).length;
    return '<div class="muted" style="margin:6px 0">' + shown.length + ' of ' + total + ' places ' +
      '<a class="pull-right" data-act="filter-clear" role="button">clear filters</a></div>' +
      (unpinned ? '<div class="alert alert-warning" style="padding:6px 10px">' + unpinned + ' need a pin. <a href="#/import">Open the queue</a></div>' : '') +
      (shown.map(Plato.places.rowHtml).join('') || '<p class="muted">Nothing here yet. Use “+ Add place” or the Import page.</p>');
  }
  function addHtml() {
    var res = state.results;
    return '<h4>Add a place</h4><form data-form="geo-search"><div class="input-group"><input class="form-control" name="q" placeholder="Name or address" required autofocus>' +
      '<span class="input-group-btn"><button class="btn btn-primary"' + (state.searching ? ' disabled' : '') + '>' + (state.searching ? 'Searching…' : 'Search') + '</button></span></div></form>' +
      '<p class="muted" style="margin-top:8px">…or click the map to drop a pin.</p>' +
      (res ? (res.length ? res.map(function (r, i) {
        return '<div class="place-row" data-act="geo-pick" data-i="' + i + '"><div class="name">' + esc(r.name || r.display_name.split(',')[0]) +
          '</div><div class="sub">' + esc(r.display_name) + '</div></div>';
      }).join('') : '<p>No matches. Try adding a city, or click the map.</p>') : '') +
      '<p style="margin-top:10px"><button class="btn btn-default btn-sm" data-act="place-add-cancel">Cancel</button></p>' +
      '<p class="muted" style="font-size:11px">Search by Nominatim / OpenStreetMap.</p>';
  }
  function panelHtml() {
    if (state.adding) return addHtml();
    return '<p><button class="btn btn-success btn-block" data-act="place-add">+ Add place</button></p>' +
      '<div id="panel-filters">' + filtersHtml() + '</div><div id="panel-list">' + listHtml() + '</div>';
  }

  function refreshMarkers() {
    if (!map) return;
    cluster.clearLayers();
    markers = {};
    var layers = [];
    Plato.places.filter(state.filters).forEach(function (p) {
      if (!util.hasPin(p)) return;
      var m = L.marker([p.lat, p.lng], { icon: iconFor(p), title: p.name });
      m.bindPopup(function () { var cur = db.place(p.id); return cur ? Plato.places.popupHtml(cur) : ''; }, { minWidth: 220 });
      markers[p.id] = m;
      layers.push(m);
    });
    cluster.addLayers(layers);
  }
  function refreshList() {
    var el = document.getElementById('panel-list');
    if (el) el.innerHTML = listHtml();
    refreshMarkers();
  }
  function refresh() {
    var root = document.querySelector('.map-page'); if (!root) return;
    root.classList.toggle('panel-closed', !state.panelOpen);
    root.classList.toggle('map-picking', !!state.pick);
    document.getElementById('side-panel').innerHTML = panelHtml();
    var pick = state.pick, target = pick && pick.id ? db.place(pick.id) : null;
    document.getElementById('pick-banner').innerHTML = pick
      ? '<div class="pick-banner">Click the map to ' + (target ? 'place “' + esc(target.name) + '”' : 'drop a pin') +
        (pick.kind === 'repin' ? '<a data-act="pick-cancel">cancel</a>' : '') + '</div>' : '';
    document.querySelector('.panel-toggle').textContent = state.panelOpen ? '‹' : '›';
    refreshMarkers();
    if (map) map.invalidateSize();
  }
  function setTemp(latlng) {
    if (temp) temp.remove();
    temp = latlng && map ? L.marker(latlng, { icon: pinIcon('#f0ad4e', '+', 'temp') }).addTo(map) : null;
  }
  function doFocus(id) {
    if (!markers[id] && db.place(id) && util.hasPin(db.place(id))) { state.filters = noFilters(); refresh(); }
    var m = markers[id];
    if (!m) { Plato.toast('That place has no pin yet'); return; }
    if (state.panelOpen && window.innerWidth <= 700) { state.panelOpen = false; refresh(); m = markers[id]; }
    cluster.zoomToShowLayer(m, function () { if (map && markers[id] === m) m.openPopup(); });
  }
  function onMapClick(ev) {
    var pick = state.pick; if (!pick) return;
    var lat = +ev.latlng.lat.toFixed(6), lng = +ev.latlng.lng.toFixed(6);
    if (pick.kind === 'new') { setTemp([lat, lng]); Plato.places.openForm(null, { lat: lat, lng: lng }); return; }
    state.pick = null;
    store.commit(function () {
      var p = db.place(pick.id); if (!p) return;
      p.lat = lat; p.lng = lng; p.updated_at = util.nowIso(); delete p.needs_pin;
    });
    Plato.toast('Pin placed', 'success');
    doFocus(pick.id);
  }

  Plato.pages.map = {
    title: 'Map',
    render: function () {
      return '<div class="map-page"><aside class="side-panel" id="side-panel"></aside><div class="map-wrap">' +
        '<button class="panel-toggle" data-act="panel-toggle" title="Show or hide the panel"></button>' +
        '<div id="map"></div><div id="pick-banner"></div></div></div>';
    },
    mount: function () {
      var s = store.data.settings, v = state.view || { center: [s.home_lat, s.home_lng], zoom: s.default_zoom };
      map = L.map('map').setView(v.center, v.zoom || 13);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
      Plato.basemap.addTo(map);
      L.marker([s.home_lat, s.home_lng], { icon: pinIcon('#333', '🏠'), title: 'Home', zIndexOffset: -100 }).addTo(map).bindPopup('Home');
      cluster = L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false }).addTo(map);
      map.on('click', onMapClick);
      map.on('popupopen', function (e) { e.popup.getElement().addEventListener('click', Plato.app.onClick); });
      map.on('moveend', function () { var c = map.getCenter(); state.view = { center: [c.lat, c.lng], zoom: map.getZoom() }; });
      refresh();
      if (state.focusId) { var id = state.focusId; state.focusId = null; doFocus(id); }
    },
    update: refresh,
    unmount: function () {
      if (map) { map.stop(); map.closePopup(); map.off(); map.remove(); }
      map = cluster = temp = null; markers = {};
    }
  };

  Plato.map = {
    tiles: TILES, attribution: ATTRIBUTION, pinIcon: pinIcon,
    focus: function (id) {
      if (map) return doFocus(id);
      state.focusId = id; location.hash = '#/map';
    },
    startPick: function (pick) {
      state.pick = pick; state.adding = false;
      if (map) refresh(); else location.hash = '#/map';
    },
    showList: function (listId) { state.filters = noFilters(); state.filters.list = listId; location.hash = '#/map'; },
    placeSaved: function (id, isNew) {
      if (!map) return;
      if (isNew) { state.adding = false; state.pick = null; state.results = null; setTemp(null); refresh(); doFocus(id); }
    }
  };

  Plato.changes.filter = function (el) { state.filters[el.dataset.key] = el.value; refresh(); };
  Plato.changes['filter-q'] = function (el) { state.filters.q = el.value; refreshList(); };

  Plato.forms['geo-search'] = function (data) {
    state.searching = true; refresh();
    util.api('POST', '/api/geocode', { q: data.q }).then(function (res) { state.results = res.results || []; })
      .catch(function (err) { state.results = []; Plato.toast('Search failed: ' + err.message, 'error'); })
      .then(function () { state.searching = false; refresh(); });
  };
  Plato.forms.settings = function (data) {
    store.commit(function (d) {
      d.settings.home_lat = Number(data.home_lat) || 0;
      d.settings.home_lng = Number(data.home_lng) || 0;
      d.settings.default_zoom = Math.min(19, Math.max(1, Number(data.default_zoom) || 13));
    });
    Plato.modal.close();
    Plato.toast('Settings saved. Reload to move the home marker.', 'success');
  };

  Object.assign(Plato.actions, {
    'panel-toggle': function () { state.panelOpen = !state.panelOpen; refresh(); },
    'filter-tag': function (el) {
      var tags = state.filters.tags, i = tags.indexOf(el.dataset.tag);
      if (i >= 0) tags.splice(i, 1); else tags.push(el.dataset.tag);
      refresh();
    },
    'filter-clear': function () { state.filters = noFilters(); refresh(); },
    'place-add': function () { state.adding = true; state.results = null; state.pick = { kind: 'new' }; state.panelOpen = true; refresh(); },
    'place-add-cancel': function () { state.adding = false; state.pick = null; state.results = null; setTemp(null); refresh(); },
    'pick-cancel': function () { state.pick = null; refresh(); },
    'geo-pick': function (el) {
      var r = (state.results || [])[Number(el.dataset.i)]; if (!r) return;
      setTemp([r.lat, r.lng]);
      map.setView([r.lat, r.lng], Math.max(map.getZoom(), 16));
      Plato.places.openForm(null, { name: r.name || r.display_name.split(',')[0], address: r.display_name, lat: r.lat, lng: r.lng });
    },
    'settings-open': function () {
      var s = store.data.settings;
      var input = function (label, name, value) {
        return '<div class="form-group"><label>' + label + '</label><input class="form-control" type="number" step="any" name="' + name + '" value="' + esc(value) + '" required></div>';
      };
      Plato.modal.open({ title: 'Settings', body: '<form data-form="settings">' + input('Home latitude', 'home_lat', s.home_lat) +
        input('Home longitude', 'home_lng', s.home_lng) + input('Default zoom (1 to 19)', 'default_zoom', s.default_zoom) +
        '<p class="muted">Home is where the map opens and what place searches prefer. Times are shown in America/New_York.</p>' +
        '<div class="text-right">' + (state.view ? '<button type="button" class="btn btn-default pull-left" data-act="settings-use-view">Use current map view</button>' : '') +
        '<button type="button" class="btn btn-default" data-act="modal-close">Cancel</button> <button class="btn btn-primary">Save</button></div></form>' });
    },
    'settings-use-view': function (el) {
      var f = el.form, v = state.view; if (!v) return;
      f.home_lat.value = v.center[0].toFixed(5); f.home_lng.value = v.center[1].toFixed(5); f.default_zoom.value = v.zoom;
    }
  });
})();
