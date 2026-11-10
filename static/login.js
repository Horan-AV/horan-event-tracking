// The sign-in page's script (kept in its own file so the page can forbid inline scripts).
let mode = 'passcode', who = null;
const $ = (id) => document.getElementById(id);
fetch('/api/login-options').then((r) => r.json()).then((o) => {
  const name = o.app_name || 'Horan Event Tracking';
  const renamed = !o.default_name;
  document.title = 'Sign in · ' + name;
  // The app's own logo already says what it is; a renamed app shows its name (and its own logo, if one was uploaded).
  if (o.has_logo || !renamed) $('lg').hidden = false;
  if (renamed) $('bn').textContent = name;
  $('intro').textContent = 'Enter the passcode set on the computer running ' + name + '.';
  if (o.mode !== 'users') { $('intro').textContent = 'This device is connecting over the network. Enter the passcode set on the computer running ' + name + '.'; return; }
  mode = 'users';
  $('intro').textContent = 'Choose your name and enter your PIN.';
  $('pc-label').textContent = 'PIN';
  $('pc').setAttribute('inputmode', 'numeric');
  $('pc').autocomplete = 'off';
  $('who').hidden = false;
  let last = null;
  try { last = localStorage.getItem('het-last-user'); } catch (e) {}
  const pick = (b) => {
    who = Number(b.dataset.id);
    for (const x of $('people').children) x.setAttribute('aria-checked', String(x === b));
    $('pc').value = ''; $('pc').focus();
  };
  for (const u of o.users) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = u.name; b.dataset.id = u.id; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    b.onclick = () => pick(b);
    $('people').appendChild(b);
    if (String(u.id) === last || o.users.length === 1) pick(b);
  }
}).catch(() => {});
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('go'), err = document.getElementById('err');
  if (mode === 'users' && !who) { err.textContent = 'Choose your name first'; return; }
  btn.disabled = true; err.textContent = '';
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'horan-rms' },
      body: JSON.stringify(mode === 'users' ? { user_id: who, pin: $('pc').value } : { passcode: $('pc').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    try { if (who) localStorage.setItem('het-last-user', String(who)); } catch (e2) {}
    location.reload();
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
    document.getElementById('pc').select();
  }
});

// No logo to show: take the empty picture away.
(function () {
  const img = $('lgi');
  const gone = () => { const pic = img.closest('picture'); if (pic) pic.remove(); };
  if (img.complete && !img.naturalWidth) gone(); else img.addEventListener('error', gone);
})();
