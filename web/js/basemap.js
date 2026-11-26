/* Offline fallback map. Drawn underneath the OpenStreetMap tiles, so it only
   shows where tiles have not loaded (no internet). Data: web/vendor/basemap/basemap.json,
   built by tools/build_basemap.py from Natural Earth + a neighborhoods file. */
(function () {
  'use strict';
  var Plato = window.Plato, esc = Plato.util.esc;
  var data = null, loading = null;
  var STYLE = {
    land: { stroke: false, fillColor: '#f2efe9', fillOpacity: 1 },
    urban: { stroke: false, fillColor: '#e6e1d8', fillOpacity: 1 },
    lakes: { stroke: false, fillColor: '#aad3df', fillOpacity: 1 },
    hoods: { color: '#cdbfae', weight: 1, fillColor: '#ebe6dd', fillOpacity: 0.6 },
    rivers: { color: '#aad3df', weight: 3 },
    states: { color: '#a79cc0', weight: 1.5, dashArray: '6 4' }
  };

  function load() {
    loading = loading || fetch('/vendor/basemap/basemap.json')
      .then(function (res) { if (!res.ok) throw new Error('no basemap'); return res.json(); })
      .then(function (json) { data = json; return json; })
      .catch(function () { return null; });
    return loading;
  }
  function label(p, cls) {
    return L.marker([p.lat, p.lng], { pane: 'offline-labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'offline-label ' + cls, iconSize: [120, 16], html: esc(p.name) }) });
  }
  function draw(map) {
    if (!data || !map._mapPane) return;           // no data, or the map was closed meanwhile
    map.createPane('offline').style.zIndex = 100;  // tiles sit at 200 and cover all of this
    map.createPane('offline-labels').style.zIndex = 150;
    map.getPane('offline').style.pointerEvents = 'none';
    map.getPane('offline-labels').style.pointerEvents = 'none';
    var renderer = L.canvas({ pane: 'offline' }), b = data.bbox;
    // water only inside the covered area; beyond it the plain grey means "no offline data"
    L.rectangle([[b[1], b[0]], [b[3], b[2]]], { renderer: renderer, interactive: false, stroke: false, fillColor: '#aad3df', fillOpacity: 1 }).addTo(map);
    var add = function (name, style) {
      L.geoJSON({ type: 'FeatureCollection', features: data.layers[name] || [] },
        { renderer: renderer, interactive: false, style: style }).addTo(map);
    };
    ['land', 'urban', 'lakes', 'hoods', 'rivers', 'states'].forEach(function (n) { add(n, STYLE[n]); });
    add('roads', function (f) { return { color: '#9a9a9a', weight: f.properties.major ? 3.5 : 2 }; });
    add('roads', function (f) { return { color: f.properties.major ? '#f9d48a' : '#ffffff', weight: f.properties.major ? 2.2 : 1.2 }; });
    var cities = L.layerGroup(data.places.map(function (p) { return label(p, p.big ? 'city big' : 'city'); }));
    var hoods = L.layerGroup(data.hood_labels.map(function (p) { return label(p, 'hood'); }));
    var sync = function () {
      var z = map.getZoom();
      if (z >= 13) { map.addLayer(hoods); map.removeLayer(cities); } else { map.addLayer(cities); map.removeLayer(hoods); }
    };
    map.on('zoomend', sync);
    sync();
    if (map.attributionControl) map.attributionControl.addAttribution('offline map: Natural Earth, OpenDataPhilly');
  }

  Plato.basemap = { addTo: function (map) { load().then(function () { draw(map); }); } };
})();
