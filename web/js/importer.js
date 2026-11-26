/* Import page: upload Google Takeout files, preview, confirm, and the "Needs pin" queue. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, store = Plato.store, esc = util.esc;
  var job = null, busy = false, timer = null;
  var LABEL = { 'new': 'label-success', duplicate: 'label-default', failed: 'label-warning' };

  function redraw() { if (Plato.app.current() === 'import') Plato.app.redraw(); }
  function poll() {
    clearTimeout(timer);
    if (!job || job.state !== 'running') return;
    timer = setTimeout(function () {
      util.api('GET', '/api/import/' + job.id).then(function (res) { job = res; redraw(); poll(); })
        .catch(function (err) { job = null; Plato.toast('Import failed: ' + err.message, 'error'); redraw(); });
    }, 1000);
  }

  function previewHtml() {
    if (!job) return '';
    var warn = (job.warnings || []).map(function (w) { return '<div class="alert alert-warning">' + esc(w) + '</div>'; }).join('');
    if (job.state === 'error') return warn + '<div class="alert alert-danger">' + esc(job.error) + '</div>';
    if (job.state === 'running') {
      var p = job.progress || { done: 0, total: 0 }, pct = p.total ? Math.round(100 * p.done / p.total) : 0;
      return warn + '<h3>Checking places…</h3><div class="progress"><div class="progress-bar" style="width:' + pct + '%">' + p.done + ' / ' + p.total +
        '</div></div><p class="muted">Places without coordinates are looked up with Nominatim at one per second, so big lists take a while. Results are cached.</p>';
    }
    var c = job.counts, rows = job.rows.map(function (r) {
      return '<tr><td><span class="label ' + LABEL[r.status] + '">' + esc(r.status === 'failed' ? 'needs pin' : r.status) + '</span></td>' +
        '<td><b>' + esc(r.name) + '</b><div class="muted" style="font-size:12px">' + esc(r.address || '') + '</div></td><td>' + esc(r.list_name) + '</td>' +
        '<td>' + (r.saved_at ? esc(util.fmtDate(r.saved_at)) : '<span class="muted">import time (est.)</span>') + '</td>' +
        '<td class="muted">' + esc(r.detail || (r.geocoded ? 'geocoded' : '')) + '</td></tr>';
    }).join('');
    var lists = job.lists.map(function (l) {
      return '<li><b>' + esc(l.name) + '</b>: ' + l.rows + ' rows → ' + (l.exists ? 'existing list “' + esc(l.target) + '”' : 'new list') + '</li>';
    }).join('');
    return warn + '<h3>Preview</h3><p><span class="label label-success">' + c['new'] + ' new</span> <span class="label label-default">' + c.duplicate +
      ' duplicate</span> <span class="label label-warning">' + c.failed + ' failed to geocode</span></p><ul>' + lists + '</ul>' +
      '<p><button class="btn btn-primary" data-act="import-commit"' + (busy || !job.rows.length ? ' disabled' : '') + '>Confirm import</button> ' +
      '<button class="btn btn-default" data-act="import-discard">Discard</button></p>' +
      '<p class="muted">Duplicates are not copied; they are only added to the list if they are not on it yet. Existing “added” dates are never changed.</p>' +
      '<div style="max-height:420px;overflow:auto"><table class="table table-condensed"><thead><tr><th>Result</th><th>Place</th><th>List</th><th>Saved</th><th></th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
  }
  function queueHtml() {
    var queue = store.data.places.filter(function (p) { return !util.hasPin(p); });
    if (!queue.length) return '<p class="muted">Nothing is waiting for a pin.</p>';
    return '<table class="table table-condensed"><tbody>' + queue.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b><div class="muted" style="font-size:12px">' + esc(p.address || '') + '</div></td>' +
        '<td>' + (util.safeUrl(p.google_maps_url) ? '<a href="' + esc(p.google_maps_url) + '" target="_blank" rel="noopener">Google Maps ↗</a>' : '') + '</td>' +
        '<td class="text-right"><button class="btn btn-primary btn-xs" data-act="place-repin" data-id="' + p.id + '">Place on map</button> ' +
        '<button class="btn btn-default btn-xs" data-act="place-edit" data-id="' + p.id + '">Edit</button></td></tr>';
    }).join('') + '</tbody></table>';
  }

  Plato.pages['import'] = {
    title: 'Import',
    render: function () {
      return '<div class="page container"><div class="page-head"><h2>Import from Google Takeout</h2></div>' +
        '<p>Go to <b>takeout.google.com</b>, export <b>Saved</b> and <b>Maps (your places)</b>, then upload the .zip, or the files inside it: ' +
        '<code>Saved/*.csv</code> (one per list, e.g. <code>Want to go.csv</code>, <code>Favorite places.csv</code>) and <code>Maps (your places)/Saved Places.json</code>.</p>' +
        '<form data-form="import-upload" class="form-inline" style="margin-bottom:15px"><input class="form-control" type="file" name="files" multiple accept=".csv,.json,.zip" required> ' +
        '<button class="btn btn-primary"' + (busy ? ' disabled' : '') + '>Upload and preview</button></form>' +
        previewHtml() + '<h3>Needs pin</h3><p class="muted">Places that could not be found automatically. Click “Place on map”, then click where the place is.</p>' +
        queueHtml() + '</div>';
    },
    mount: poll,
    unmount: function () { clearTimeout(timer); }
  };

  Plato.forms['import-upload'] = function (_data, form) {
    if (store.mode !== 'server') { Plato.toast('Importing needs the Plato server running', 'error'); return; }
    var body = new FormData();
    Array.prototype.forEach.call(form.elements.files.files, function (f) { body.append('files', f, f.name); });
    busy = true; redraw();
    store.flush().then(function () { return util.api('POST', '/api/import', body); })
      .then(function (res) { job = res; })
      .catch(function (err) { Plato.toast('Upload failed: ' + err.message, 'error'); })
      .then(function () { busy = false; redraw(); poll(); });
  };

  Object.assign(Plato.actions, {
    'import-discard': function () { job = null; redraw(); },
    'import-commit': function () {
      if (!job || busy) return;
      busy = true; redraw();
      store.flush().then(function () { return util.api('POST', '/api/import/commit', { import_id: job.id }); })
        .then(function (res) {
          var s = res.summary; job = null; busy = false;
          store.adopt(res.data);
          Plato.toast('Imported ' + s.places_added + ' places, ' + s.items_added + ' list entries' +
            (s.needs_pin ? '; ' + s.needs_pin + ' need a pin' : ''), 'success');
        }).catch(function (err) { busy = false; Plato.toast('Import failed: ' + err.message, 'error'); redraw(); });
    }
  });
})();
