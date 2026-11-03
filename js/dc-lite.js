/* dc-lite: a tiny runtime for the portfolio's component pages.
   Template syntax: {{ path }} in text/attributes, <sc-if value>, <sc-for list as>,
   onClick/onChange="{{ fn }}", ref="{{ fn }}". Re-renders via Idiomorph so
   CSS transitions, videos and focus survive state changes. */
(function () {
  'use strict';
  var RE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var EVENT_ATTRS = { onclick: 'click', onchange: 'change', oninput: 'input', onkeydown: 'keydown' };

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    for (var i = scopes.length - 1; i >= 0; i--) {
      var s = scopes[i];
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        var v = s[parts[0]];
        for (var j = 1; j < parts.length && v != null; j++) v = v[parts[j]];
        return v;
      }
    }
    return undefined;
  }
  function interp(str, scopes) {
    if (str.indexOf('{{') < 0) return str;
    var m = /^\{\{\s*([^}]*?)\s*\}\}$/.exec(str);
    if (m) return lookup(m[1], scopes);
    return str.replace(RE, function (_, p) { var v = lookup(p, scopes); return v == null ? '' : String(v); });
  }
  function toStr(v) { return v == null ? '' : String(v); }

  function Renderer(tplRoot, ctx) {
    this.tpl = tplRoot; this.ctx = ctx;
  }
  Renderer.prototype.render = function (scopes) {
    var frag = document.createDocumentFragment();
    this.handlers = []; this.refs = [];
    for (var n = this.tpl.firstChild; n; n = n.nextSibling) this.node(n, scopes, frag);
    return frag;
  };
  Renderer.prototype.node = function (n, scopes, out) {
    if (n.nodeType === 3) {
      var t = n.nodeValue;
      out.appendChild(document.createTextNode(t.indexOf('{{') >= 0 ? toStr(interp(t, scopes)) : t));
      return;
    }
    if (n.nodeType !== 1) return;
    var tag = n.tagName.toLowerCase();
    if (tag === 'sc-if') {
      if (interp(n.getAttribute('value') || '', scopes)) for (var c = n.firstChild; c; c = c.nextSibling) this.node(c, scopes, out);
      return;
    }
    if (tag === 'sc-for') {
      var list = interp(n.getAttribute('list') || '', scopes) || [];
      var as = n.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var sc = {}; sc[as] = list[i]; sc[as + 'Index'] = i;
        for (var c2 = n.firstChild; c2; c2 = c2.nextSibling) this.node(c2, scopes.concat([sc]), out);
      }
      return;
    }
    var svg = n.namespaceURI === 'http://www.w3.org/2000/svg';
    var el = svg ? document.createElementNS(n.namespaceURI, n.tagName) : document.createElement(n.tagName);
    for (var a = 0; a < n.attributes.length; a++) {
      var at = n.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-placeholder') === 0) continue;
      var lower = name.toLowerCase();
      if (EVENT_ATTRS[lower] && val.indexOf('{{') >= 0) {
        var fn = interp(val, scopes);
        if (typeof fn === 'function') { this.handlers.push({ type: EVENT_ATTRS[lower], fn: fn }); el.setAttribute('data-dc-h', String(this.handlers.length - 1)); }
        continue;
      }
      if (lower === 'ref' && val.indexOf('{{') >= 0) {
        var rf = interp(val, scopes);
        if (typeof rf === 'function') { this.refs.push(rf); el.setAttribute('data-dc-ref', String(this.refs.length - 1)); }
        continue;
      }
      if (val.indexOf('{{') >= 0) {
        var v = interp(val, scopes);
        if (v === false || v == null) { if (lower === 'aria-selected' || lower === 'aria-pressed' || lower === 'aria-expanded') el.setAttribute(name, 'false'); continue; }
        if (v === true && (lower === 'disabled' || lower === 'hidden' || lower === 'checked' || lower === 'autoplay')) { el.setAttribute(name, ''); continue; }
        el.setAttribute(name, toStr(v));
      } else el.setAttribute(name, val);
    }
    for (var c3 = n.firstChild; c3; c3 = c3.nextSibling) this.node(c3, scopes, el);
    out.appendChild(el);
  };

  window.DCLogic = function () {};
  window.DCLogic.prototype.setState = function (partial) {
    var self = this;
    self.state = Object.assign({}, self.state || {}, typeof partial === 'function' ? partial(self.state) : partial);
    if (self.__pending) return;
    self.__pending = true;
    Promise.resolve().then(function () { self.__pending = false; self.__render(); });
  };

  function mount(Component, templateEl, rootEl, props) {
    var parser = new DOMParser();
    var doc = parser.parseFromString('<!doctype html><html><body><div id="t">' + templateEl.textContent + '</div></body></html>', 'text/html');
    var tplRoot = doc.getElementById('t');
    var comp = new Component();
    comp.props = props || {};
    var r = new Renderer(tplRoot, comp);
    comp.__render = function () {
      var vals = comp.renderVals ? comp.renderVals() : {};
      var scopes = [comp.props, vals];
      var frag = r.render(scopes);
      var next = document.createElement('div'); next.appendChild(frag);
      if (window.Idiomorph) {
        window.Idiomorph.morph(rootEl, next, { morphStyle: 'innerHTML', ignoreActiveValue: true, callbacks: {
          beforeAttributeUpdated: function (name, node) { /* keep media playing: do not reset src on identical values */ return true; }
        } });
      } else { rootEl.innerHTML = ''; while (next.firstChild) rootEl.appendChild(next.firstChild); }
      rootEl.__dcHandlers = r.handlers;
      var refs = rootEl.querySelectorAll('[data-dc-ref]');
      for (var i = 0; i < refs.length; i++) { var fn = r.refs[Number(refs[i].getAttribute('data-dc-ref'))]; if (fn) fn(refs[i]); }
    };
    ['click', 'change', 'input', 'keydown'].forEach(function (type) {
      rootEl.addEventListener(type, function (e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-dc-h]') : null;
        while (t && rootEl.contains(t)) {
          var h = rootEl.__dcHandlers && rootEl.__dcHandlers[Number(t.getAttribute('data-dc-h'))];
          if (h && h.type === type) { h.fn(e); return; }
          t = t.parentElement && t.parentElement.closest ? t.parentElement.closest('[data-dc-h]') : null;
        }
      });
    });
    comp.__render();
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', function () { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
    return comp;
  }
  window.DCLite = { mount: mount };
})();
