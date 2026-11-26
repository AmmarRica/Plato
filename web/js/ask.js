/* Ask Plato: optional chat over the saved places. Hidden unless the server has an API key. */
(function () {
  'use strict';
  var Plato = window.Plato, util = Plato.util, esc = util.esc;
  var open = false, busy = false, log = [];

  function draw() {
    var root = document.getElementById('ask-root');
    if (!open) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="ask-box"><div class="ask-head"><span>💬 Ask Plato</span><a data-act="ask-toggle">✕</a></div><div class="ask-log" id="ask-log">' +
      (log.length ? '' : '<p class="muted">Ask about your saved places, e.g. “where should I get coffee near Rittenhouse?”</p>') +
      log.map(function (m) { return '<div class="ask-msg ' + m.role + '">' + esc(m.content) + '</div>'; }).join('') +
      (busy ? '<div class="ask-msg assistant muted">Plato is thinking…</div>' : '') + '</div>' +
      '<form data-form="ask"><input class="form-control input-sm" name="question" placeholder="Ask a question" autocomplete="off" required' + (busy ? ' disabled' : '') + '>' +
      '<button class="btn btn-primary btn-sm"' + (busy ? ' disabled' : '') + '>Ask</button></form></div>';
    var el = document.getElementById('ask-log'); el.scrollTop = el.scrollHeight;
    var input = root.querySelector('input'); if (input && !busy) input.focus();
  }

  Plato.ask = {
    enable: function (on) { document.getElementById('ask-button').classList.toggle('hidden', !on); }
  };
  Plato.actions['ask-toggle'] = function () { open = !open; draw(); };
  Plato.forms.ask = function (data) {
    var question = data.question.trim(); if (!question || busy) return;
    var history = log.slice();
    log.push({ role: 'user', content: question });
    busy = true; draw();
    Plato.store.flush().then(function () { return util.api('POST', '/api/ask', { question: question, history: history }); })
      .then(function (res) { log.push({ role: 'assistant', content: res.answer }); })
      .catch(function (err) { log.pop(); Plato.toast('Ask Plato: ' + err.message, 'error'); })
      .then(function () { busy = false; draw(); });
  };
})();
