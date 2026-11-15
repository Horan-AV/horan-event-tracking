// The sign-in page's script (kept in its own file so the page can forbid inline scripts).
let mode = 'passcode';
const REMEMBER_KEY = 'het-username';
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
  $('intro').textContent = 'Enter your username and password.';
  $('pc-label').textContent = 'Password';
  $('pc').autocomplete = 'current-password';
  $('who').hidden = false;
  $('rem-row').hidden = false;
  $('un').required = true;
  // "Remember my username": this device fills it in next time, so you only type your password
  let saved = '';
  try { saved = localStorage.getItem(REMEMBER_KEY) || ''; } catch (e) {}
  if (saved) { $('un').value = saved; $('rem').checked = true; $('pc').focus(); } else { $('un').focus(); }
}).catch(() => {});
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('go'), err = document.getElementById('err');
  const username = mode === 'users' ? $('un').value.trim() : '';
  if (mode === 'users' && !username) { err.textContent = 'Enter your username'; $('un').focus(); return; }
  btn.disabled = true; err.textContent = '';
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'horan-rms' },
      body: JSON.stringify(mode === 'users' ? { username, password: $('pc').value } : { passcode: $('pc').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    try {
      if (mode === 'users' && $('rem').checked) localStorage.setItem(REMEMBER_KEY, username.toLowerCase());
      else if (mode === 'users') localStorage.removeItem(REMEMBER_KEY);
      localStorage.removeItem('het-last-user');   // from before usernames
    } catch (e2) {}
    // Signed in with an old short PIN: the app will suggest choosing a proper password.
    try { if (data.weak) sessionStorage.setItem('het-weak-password', '1'); } catch (e3) {}
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
