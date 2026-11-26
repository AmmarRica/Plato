/* Tags page: names, colors, emoji icons, merge, usage counts. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, db = Plato.db, store = Plato.store, esc = util.esc;

  function openForm(tag) {
    var t = tag || { name: '', icon: '', color: util.PALETTE[store.data.tags.length % util.PALETTE.length] };
    Plato.modal.open({ title: tag ? 'Edit tag' : 'New tag', body:
      '<form data-form="tag"><input type="hidden" name="original" value="' + esc(tag ? tag.name : '') + '">' +
      '<div class="row"><div class="col-xs-6"><div class="form-group"><label>Name</label><input class="form-control" name="name" value="' + esc(t.name) + '" required autofocus placeholder="korean"></div></div>' +
      '<div class="col-xs-3"><div class="form-group"><label>Emoji</label><input class="form-control" name="icon" value="' + esc(t.icon) + '" maxlength="8" placeholder="🍲"></div></div>' +
      '<div class="col-xs-3"><div class="form-group"><label>Color</label><input class="form-control" type="color" name="color" value="' + esc(util.color(t.color)) + '"></div></div></div>' +
      '<p class="muted">Names are lowercase. Renaming to a name that already exists merges the two tags.</p>' +
      '<div class="text-right"><button type="button" class="btn btn-default" data-act="modal-close">Cancel</button> <button class="btn btn-primary">Save</button></div></form>' });
  }

  Plato.pages.tags = {
    title: 'Tags',
    render: function () {
      var rows = store.data.tags.map(function (t) {
        var n = db.tagCount(t.name), name = esc(t.name);
        return '<tr><td style="font-size:20px;width:50px">' + esc(t.icon || '') + '</td><td>' + Plato.places.chip(t.name) + '</td>' +
          '<td>' + n + (n === 1 ? ' place' : ' places') + '</td><td class="text-right">' +
          '<button class="btn btn-default btn-xs" data-act="tag-edit" data-tag="' + name + '">Edit</button> ' +
          '<button class="btn btn-default btn-xs" data-act="tag-merge" data-tag="' + name + '">Merge into…</button> ' +
          '<button class="btn btn-default btn-xs" data-act="tag-delete" data-tag="' + name + '">Delete</button></td></tr>';
      }).join('');
      return '<div class="page container"><div class="page-head"><h2>Tags</h2><button class="btn btn-success" data-act="tag-new">+ New tag</button></div>' +
        (rows ? '<table class="table table-hover"><thead><tr><th></th><th>Tag</th><th>Used by</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="muted">No tags yet. They are created the first time you type one on a place.</p>') + '</div>';
    }
  };

  Plato.forms.tag = function (data) {
    var name = util.normTag(data.name);
    if (!name) return;
    store.commit(function (d) {
      if (data.original && data.original !== name) db.renameTag(data.original, name);
      var t = db.tag(name);
      if (!t) { t = { name: name }; d.tags.push(t); }
      t.color = util.color(data.color);
      t.icon = data.icon.trim();
    });
    Plato.modal.close();
    Plato.toast('Tag saved', 'success');
  };
  Plato.forms['tag-merge'] = function (data) {
    if (!data.into || data.into === data.from) return;
    store.commit(function () { db.renameTag(data.from, data.into); });
    Plato.modal.close();
    Plato.toast('Merged "' + data.from + '" into "' + data.into + '"', 'success');
  };

  Object.assign(Plato.actions, {
    'tag-new': function () { openForm(null); },
    'tag-edit': function (el) { openForm(db.tag(el.dataset.tag)); },
    'tag-delete': function (el) {
      var name = el.dataset.tag, n = db.tagCount(name);
      if (!confirm('Delete the tag "' + name + '"' + (n ? ' and remove it from ' + n + ' places?' : '?'))) return;
      store.commit(function () { db.removeTag(name); });
    },
    'tag-merge': function (el) {
      var from = el.dataset.tag;
      var others = store.data.tags.filter(function (t) { return t.name !== from; }).map(function (t) { return [t.name, t.name]; });
      if (!others.length) { Plato.toast('There is no other tag to merge into'); return; }
      Plato.modal.open({ title: 'Merge "' + from + '"', body:
        '<form data-form="tag-merge"><input type="hidden" name="from" value="' + esc(from) + '">' +
        '<div class="form-group"><label>Every place tagged “' + esc(from) + '” gets this tag instead</label>' +
        '<select class="form-control" name="into">' + util.options(others) + '</select></div>' +
        '<div class="text-right"><button type="button" class="btn btn-default" data-act="modal-close">Cancel</button> <button class="btn btn-primary">Merge</button></div></form>' });
    }
  });
})();
