/* Modo administrador: acceso (Ctrl+Shift+A), barra, editor de obras, ajustes, respaldo y restauración.
   Nada de esto existe en el DOM para el público: se crea sólo tras iniciar sesión. */
(function (T) {
'use strict';
const { $, h, clamp, toast, modal, closeModals, mkImg, safeUrl, hex, unhex, hashPw, legacyHashPw, nextTick, sameStr } = T;
let bar = null, pubBtn = null;

const icon = d => { const s = h('span', { style: 'display:contents' }); s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`; return s.firstChild; };
const ICO_RESPALDO = '<path d="M4 6.500h16V10H4zM5.500 10v8.500h13V10"/><path d="M12 12.300v4.600M9.800 14.800l2.200 2.200 2.200-2.200"/>';
const ICO_RESTAURAR = '<path d="M4 12a8 8 0 1 0 2.700-6"/><path d="M4 4v4.600h4.600"/><path d="M12 8v4.500l3 1.800"/>';
const ICO_DATOS = '<ellipse cx="12" cy="6" rx="7" ry="2.600"/><path d="M5 6v6c0 1.400 3.100 2.600 7 2.600s7-1.200 7-2.600V6"/><path d="M5 12v6c0 1.400 3.100 2.600 7 2.600s7-1.200 7-2.600v-6"/>';
const ICO_CARET = '<path d="M6 9.500l6 6 6-6"/>';

/* Un solo icono (RESPALDO / RESTAURACIÓN) que despliega RESPALDAR o RESTAURAR */
let menu = null, menuBtn = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; } if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false'); }
function toggleMenu() {
  if (menu) { closeMenu(); return; }
  const item = (label, ico, sub, fn) => h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, icon(ico), h('span', null, h('strong', null, label), h('small', null, sub)));
  menu = h('div', { class: 'pop', role: 'menu' },
    item('RESPALDAR', ICO_RESPALDO, 'Descarga un archivo con todas tus obras', T.respaldar),
    item('RESTAURAR', ICO_RESTAURAR, 'Carga un respaldo y reemplaza la galería', T.restaurar));
  document.body.append(menu); menuBtn.setAttribute('aria-expanded', 'true');
  const r = menuBtn.getBoundingClientRect(), w = menu.offsetWidth;
  menu.style.top = (r.bottom + 8) + 'px'; menu.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + 'px';
}
addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) closeMenu(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && menu) { e.stopPropagation(); closeMenu(); } }, true);
addEventListener('resize', closeMenu);

/* ---------- sesión ---------- */
function enterAdmin() { T.admin = true; try { sessionStorage.setItem(T.SS, '1'); } catch (e) {} buildBar(); T.render(); }
function exitAdmin() { closeMenu(); T.admin = false; try { sessionStorage.removeItem(T.SS); } catch (e) {} if (bar) { bar.remove(); bar = null; } document.body.classList.remove('is-admin'); closeModals(); T.render(); }
function buildBar() {
  if (bar) bar.remove(); document.body.classList.add('is-admin');
  if (T.proteccionLimpiar) T.proteccionLimpiar();
  menuBtn = h('button', { class: 'btn ibtn only', type: 'button', title: 'Respaldo y restauración', 'aria-label': 'Respaldo y restauración', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: toggleMenu }, icon(ICO_DATOS), icon(ICO_CARET));
  pubBtn = h('button', { class: 'btn' + (T.sinPublicar() ? ' pend' : ''), title: 'Descarga data/obras.json para publicar los cambios', onclick: T.publicar }, 'PUBLICAR');
  bar = h('div', { class: 'abar' },
    h('span', { class: 'lbl' }, h('i'), h('em', null, 'MODO ADMINISTRADOR')),
    h('button', { class: 'btn main', onclick: () => editor(null) }, 'SUBIR OBRA'),
    h('button', { class: 'btn', onclick: settings }, 'AJUSTES'),
    h('span', { class: 'sep' }),
    menuBtn,
    h('span', { class: 'sep' }),
    pubBtn,
    h('button', { class: 'btn', onclick: exitAdmin }, 'SALIR'));
  document.body.append(bar);
}
T.onPersist = () => { if (pubBtn) pubBtn.classList.toggle('pend', T.sinPublicar()); };

let fails = 0, lockUntil = 0;
function promptLogin() {
  closeModals();
  const setup = !T.DB.auth;
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: setup ? '12' : null, placeholder: setup ? 'Nueva contraseña (mín. 12 caracteres)' : 'Contraseña' });
  const pw2 = setup ? h('input', { type: 'password', autocomplete: 'new-password', minlength: '12', placeholder: 'Repite la contraseña' }) : null;
  const msg = h('p', { class: 'msg' }); const go = h('button', { class: 'btn main' }, setup ? 'CREAR Y ENTRAR' : 'ENTRAR');
  const updateSetupMessage = () => {
    if (!setup || !pw.value || msg.classList.contains('ok')) return;
    if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
      msg.textContent = 'Para crear la contraseña, abre el sitio mediante HTTPS o localhost.';
      return;
    }
    msg.textContent = pw.value.length < 12 ? 'La contraseña debe tener al menos 12 caracteres.' : pw2.value && pw.value !== pw2.value ? 'Las contraseñas no coinciden.' : '';
  };
  if (setup) {
    pw.addEventListener('input', updateSetupMessage);
    pw2.addEventListener('input', updateSetupMessage);
    if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
      msg.textContent = 'Para crear la contraseña, abre el sitio mediante HTTPS o localhost.';
    }
  }
  const run = async () => {
    msg.className = 'msg'; msg.textContent = '';
    if (Date.now() < lockUntil) { msg.textContent = 'Demasiados intentos. Espera ' + Math.ceil((lockUntil - Date.now()) / 1000) + ' s.'; return; }
    
    if (!pw.value) return;
    go.disabled = true; msg.className = 'msg ok'; msg.textContent = 'Verificando…'; await nextTick();

    try {
      // Intentar primero con la API online
      const apiRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw.value })
      }).catch(() => null);

      if (apiRes && apiRes.ok) {
        const res = await apiRes.json();
        if (res.ok) {
          fails = 0;
          m.close(); enterAdmin();
          return;
        }
      }

      // Si no hay API o la contraseña es incorrecta para el servidor, probar local
      const auth = T.DB.auth;
      if (auth) {
        const salt = unhex(auth.salt);
        const candidate = auth.algorithm === 'legacy-sha256' ? legacyHashPw(pw.value, salt, auth.it) : await hashPw(pw.value, salt);
        if (sameStr(candidate, auth.hash)) {
          fails = 0;
          m.close(); enterAdmin();
          return;
        }
      }

      // Si llegamos aquí, falló la autenticación
      fails++;
      lockUntil = Date.now() + Math.min(30000, fails * fails * 1000);
      go.disabled = false;
      msg.className = 'msg';
      msg.textContent = 'Contraseña incorrecta.';
      pw.value = ''; pw.focus();

    } catch (e) {
      go.disabled = false;
      msg.className = 'msg';
      msg.textContent = e.message || 'Error de conexión.';
    }
  };
  go.onclick = run; [pw, pw2].forEach(i => i && i.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));
  const m = modal({ title: setup ? 'Crear contraseña de administrador' : 'Acceso de administrador',
    body: [setup ?     h('p', { class: 'note' }, 'Primera vez: define la contraseña para este navegador. Se guarda sólo su verificador derivado; no se incluye en el JSON público.') : null,
      h('div', { class: 'fld' }, pw), pw2 ? h('div', { class: 'fld' }, pw2) : null, msg],
    actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'CANCELAR'), go] });
  setTimeout(() => pw.focus(), 50);
}
/* Ctrl + Shift + A */
addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyA') {
    e.preventDefault(); e.stopPropagation();
    if (T.admin) exitAdmin(); else if ($('.modalbg')) closeModals(); else window.TCG.promptLogin();
  }
}, true);
/* Alternativa para móvil (sin teclado): mantener pulsado el título 1,5 s */
(() => { let t = null; const el = $('#siteTitle'); const on = () => { t = setTimeout(() => { if (!T.admin) window.TCG.promptLogin(); }, 1500); }, off = () => clearTimeout(t);
  el.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach(k => el.addEventListener(k, off)); })();

/* ---------- editor de obras ---------- */
async function fileToData(file) {
  if (!file || !/^image\/(?:jpeg|png|gif|webp|avif|bmp)$/i.test(file.type) || file.size > 15 * 1024 * 1024)
    throw new Error('Usa una imagen JPG, PNG, GIF, WebP, AVIF o BMP de hasta 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
    const x = c.getContext('2d'); if (!x) throw new Error('No se pudo procesar la imagen.');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .88);
  } finally { URL.revokeObjectURL(url); }
}
function editor(orig) {
  if (!T.admin) return;
  const isNew = !orig;
  m.cats = [...(m.cats || [])]; m.techs = [...(m.techs || [])]; m.palette = [...(m.palette || [])];
  let palT = 0, palTok = 0; const palBox = h('div', { class: 'palprev' }), palMsg = h('p', { class: 'note', style: 'margin:6px 0 0' });
  let pvT = 0; const pv = h('div', { class: 'pvbox' });
  const refresh = () => { clearTimeout(pvT); pvT = setTimeout(() => { pv.replaceChildren(T.cardEl(m, true).persp); }, 250); };
  const msg = h('p', { class: 'msg' });
  /* datos del archivo (nombre, n.º de dibujo, dimensiones, tamaño, copyright): automáticos, sin campos en el editor */
  const infoUpd = () => {};
  const urlField = (label, key, ph) => {
    const inp = h('input', { type: 'text', placeholder: ph, autocomplete: 'off', spellcheck: 'false' });
    const sync = () => { inp.value = m[key].startsWith('data:') ? '[archivo local incrustado]' : m[key]; }; sync();
    inp.addEventListener('input', () => { m[key] = inp.value.trim(); refresh(); if (key === 'img') { m.file = ''; calcPalSoon(); } });
    inp.addEventListener('focus', () => { if (m[key].startsWith('data:')) inp.select(); });
    const fi = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    fi.addEventListener('change', async () => { const f = fi.files[0]; if (!f) return; try { m[key] = await fileToData(f); if (key === 'img') m.file = f.name.slice(0, 160); sync(); refresh(); msg.textContent = ''; if (key === 'img') calcPal(); } catch (e) { msg.textContent = 'No se pudo leer ese archivo.'; } fi.value = ''; });
    return h('div', { class: 'fld' }, h('label', null, label), h('div', { class: 'inl' }, inp, h('button', { class: 'btn', type: 'button', onclick: () => fi.click() }, 'ARCHIVO'), fi));
  };
  const chipField = (label, key, options, single) => {
    const wrap = h('div', { class: 'chips' });
    const get = () => single ? (m[key] ? [m[key]] : []) : m[key];
    const draw = () => wrap.replaceChildren(...[...new Set([...options, ...get()])].map(o => {
      const on = get().includes(o);
      return T.tag(o, { tag: 'button', cls: 'chip plate' + (on ? ' on' : ''), deco: 'plate', check: true, attrs: { type: 'button', 'aria-pressed': String(on) }, onclick: () => {
        if (single) m[key] = on ? '' : o; else m[key] = on ? m[key].filter(x => x !== o) : [...m[key], o]; draw();
      } });
    }));
    draw(); return h('div', { class: 'fld' }, h('label', null, label), wrap);
  };
  const drawPal = () => palBox.replaceChildren(m.palette.length ? T.paletaBar(m.palette) : h('div', { class: 'palempty' }, 'SIN PALETA'));
  const calcPal = async () => {
    const tok = ++palTok; palMsg.textContent = '';
    if (!safeUrl(m.img)) { m.palette = []; drawPal(); return; }
    palMsg.textContent = 'Calculando paleta…';
    const r = await T.extraerPaleta(m.img); if (tok !== palTok) return;
    if (r && r.length) { m.palette = r; palMsg.textContent = ''; } else { m.palette = []; palMsg.textContent = 'No se pudo leer la paleta: la imagen es de otro sitio y no lo permite. Cópiala a la carpeta img/ o usa el botón ARCHIVO.'; }
    drawPal();
  };
  const calcPalSoon = () => { clearTimeout(palT); palT = setTimeout(calcPal, 500); };
  drawPal();

/* Exponer función global para el footer */
window.openAdminLogin = function() {
  if (window.TCG && typeof window.TCG.promptLogin === "function") {
    window.TCG.promptLogin();
  } else {
    console.error("promptLogin no está definido");
  }
};
