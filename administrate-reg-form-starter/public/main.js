(function(){
  const el = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  const pathParts = path.split('/');
  const isEventRoute = pathParts.length >= 2 && pathParts[0] === 'e';
  const slug = isEventRoute ? decodeURIComponent(pathParts[1]) : null;
  const byId = params.get('id');
  const byLegacy = params.get('legacyId');

  el('url').textContent = location.href;

  async function loadEvent(){
    let q = '';
    if (byLegacy) q = `legacyId=${encodeURIComponent(byLegacy)}`;
    else if (byId) q = `id=${encodeURIComponent(byId)}`;
    else if (slug) q = `code=${encodeURIComponent(slug)}`;

    if(!q){
      el('ev-title').textContent = 'No event selected yet';
      el('ev-when').textContent = 'Use /e/<eventCode> or ?legacyId=<legacyId> or ?id=<eventId>';
      return;
    }
    try{
      const res = await fetch(`/.netlify/functions/event?${q}`, { credentials: 'omit' });
      if(!res.ok){
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data = await res.json();
      el('routeHint').classList.add('hidden');
      el('ev-title').textContent = data.title || data.code || 'Event';
      el('ev-when').textContent = [data.start, data.end].filter(Boolean).join(' – ');
      el('ev-location').textContent = data.locationText || '';
      el('reg-form').classList.remove('hidden');
    }catch(err){
      el('ev-title').textContent = 'Event not found or unavailable';
      el('ev-when').textContent = err.message;
    }
  }

  async function onSubmit(e){
    e.preventDefault();
    const form = e.currentTarget;
    const submitBtn = document.getElementById('submitBtn');
    const body = {
      identifierType: byLegacy ? 'legacyId' : (byId ? 'id' : 'code'),
      identifierValue: byLegacy ? byLegacy : (byId ? byId : slug),
      learner: {
        firstName: form.firstName.value.trim(),
        lastName: form.lastName.value.trim(),
        email: form.email.value.trim(),
        company: form.company.value.trim() || undefined,
        notes: form.notes.value.trim() || undefined
      }
    };
    el('reg-error').classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Registering…';
    try{
      const res = await fetch('/.netlify/functions/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(()=>({}));
      if(!res.ok || json.success === false){
        throw new Error(json.message || `HTTP ${res.status}`);
      }
      document.getElementById('reg-form').classList.add('hidden');
      document.getElementById('success').classList.remove('hidden');
    }catch(err){
      const box = document.getElementById('reg-error');
      box.textContent = err.message;
      box.classList.remove('hidden');
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
    }
  }

  document.getElementById('reg-form').addEventListener('submit', onSubmit);
  loadEvent();
})();
