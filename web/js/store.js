/* Store: load and save the whole document, re-render on change.
   Server (/api/data) when reachable, browser localStorage as the fallback copy. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util;
  var KEY = 'plato.data', DIRTY = 'plato.dirty';
  var listeners = [], chain = Promise.resolve();

  function blank() {
    return { version: 1, places: [], lists: [], list_items: [], tags: [], geocode_cache: {},
      settings: { home_lat: 39.9526, home_lng: -75.1652, default_zoom: 13 } };
  }
  function shape(doc) {
    var base = blank();
    Object.keys(base).forEach(function (k) { if (doc[k] == null) doc[k] = base[k]; });
    return doc;
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  var store = Plato.store = {
    data: blank(),
    mode: 'server',           // 'server' or 'local'

    load: function () {
      return util.api('GET', '/api/data').then(function (doc) {
        var local = readLocal();
        if (local && localStorage.getItem(DIRTY) &&
            confirm('This browser has changes that never reached the server.\nOK: send them to the server.  Cancel: discard them.')) {
          store.data = shape(local);
          store.mode = 'server';
          return store.save();
        }
        localStorage.removeItem(DIRTY);
        store.mode = 'server';
        store.data = shape(doc);
        store.keepLocal();
      }).catch(function () {
        store.mode = 'local';
        store.data = shape(readLocal() || blank());
      });
    },
    keepLocal: function () {
      try { localStorage.setItem(KEY, JSON.stringify(store.data)); } catch (e) { /* quota: server copy still exists */ }
    },
    save: function () {
      store.keepLocal();
      var body = JSON.stringify(store.data);
      chain = chain.then(function () {
        return fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
          .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); })
          .then(function () { localStorage.removeItem(DIRTY); store.setMode('server'); })
          .catch(function () { localStorage.setItem(DIRTY, '1'); store.setMode('local'); });
      });
      return chain;
    },
    flush: function () { return chain; },
    setMode: function (mode) {
      if (store.mode !== mode && mode === 'local') Plato.toast('Server unreachable: saved in this browser only', 'error');
      store.mode = mode;
      var badge = document.getElementById('offline-badge');
      if (badge) badge.classList.toggle('hidden', mode === 'server');
    },
    /* Change the document: fn(data), then tidy, save and re-render. */
    commit: function (fn) {
      fn(store.data);
      Plato.db.tidy();
      store.save();
      store.emit();
    },
    /* Replace the document with one the server just produced (import, share). */
    adopt: function (doc) { store.data = shape(doc); store.keepLocal(); store.emit(); },
    subscribe: function (fn) { listeners.push(fn); },
    emit: function () { listeners.forEach(function (fn) { fn(store.data); }); }
  };

  /* Read and write helpers over store.data, shared by every page. */
  var db = Plato.db = {
    place: function (id) { return store.data.places.find(function (p) { return p.id === id; }); },
    list: function (id) { return store.data.lists.find(function (l) { return l.id === id; }); },
    tag: function (name) { return store.data.tags.find(function (t) { return t.name === name; }); },
    itemsOfList: function (id) {
      return store.data.list_items.filter(function (i) { return i.list_id === id; })
        .sort(function (a, b) { return new Date(b.added_at) - new Date(a.added_at); });
    },
    itemsOfPlace: function (id) { return store.data.list_items.filter(function (i) { return i.place_id === id; }); },
    item: function (listId, placeId) {
      return store.data.list_items.find(function (i) { return i.list_id === listId && i.place_id === placeId; });
    },
    /* Never overwrites an existing added_at. */
    addToList: function (listId, placeId) {
      if (db.item(listId, placeId)) return false;
      store.data.list_items.push({ list_id: listId, place_id: placeId, added_at: util.nowIso(), note: '' });
      return true;
    },
    removeFromList: function (listId, placeId) {
      store.data.list_items = store.data.list_items.filter(function (i) {
        return !(i.list_id === listId && i.place_id === placeId);
      });
    },
    removePlace: function (id) {
      store.data.places = store.data.places.filter(function (p) { return p.id !== id; });
      store.data.list_items = store.data.list_items.filter(function (i) { return i.place_id !== id; });
    },
    removeList: function (id) {
      store.data.lists = store.data.lists.filter(function (l) { return l.id !== id; });
      store.data.list_items = store.data.list_items.filter(function (i) { return i.list_id !== id; });
    },
    uniqueSlug: function (text, exceptId) {
      var base = util.slugify(text), slug = base, n = 2;
      var taken = store.data.lists.filter(function (l) { return l.id !== exceptId; }).map(function (l) { return l.share_slug; });
      while (taken.indexOf(slug) >= 0) slug = base + '-' + (n++);
      return slug;
    },
    tagCount: function (name) {
      return store.data.places.filter(function (p) { return (p.tags || []).indexOf(name) >= 0; }).length;
    },
    /* Rename a tag everywhere. Renaming onto an existing tag merges the two. */
    renameTag: function (from, to) {
      to = util.normTag(to);
      if (!to || to === from) return;
      store.data.places.forEach(function (p) {
        if ((p.tags || []).indexOf(from) < 0) return;
        p.tags = p.tags.map(function (t) { return t === from ? to : t; })
          .filter(function (t, i, all) { return all.indexOf(t) === i; });
      });
      var old = db.tag(from);
      if (db.tag(to)) store.data.tags = store.data.tags.filter(function (t) { return t.name !== from; });
      else if (old) old.name = to;
    },
    removeTag: function (name) {
      store.data.places.forEach(function (p) { p.tags = (p.tags || []).filter(function (t) { return t !== name; }); });
      store.data.tags = store.data.tags.filter(function (t) { return t.name !== name; });
    },
    /* Data rules: tags lowercase and unique, created the first time they are used. */
    tidy: function () {
      var d = store.data, seen = {};
      d.tags = d.tags.filter(function (t) {
        t.name = util.normTag(t.name);
        if (!t.name || seen[t.name]) return false;
        return (seen[t.name] = true);
      });
      d.places.forEach(function (p) {
        p.tags = (p.tags || []).map(util.normTag).filter(function (t, i, all) { return t && all.indexOf(t) === i; });
        p.tags.forEach(function (name) {
          if (seen[name]) return;
          seen[name] = true;
          d.tags.push({ name: name, color: util.PALETTE[d.tags.length % util.PALETTE.length], icon: '' });
        });
      });
    }
  };
})();
