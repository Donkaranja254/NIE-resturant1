(() => {
  const $ = id => document.getElementById(id);
  const config = window.NIE_CONFIG;
  let client, mode = 'login', currentProfile, todayMenu;
  const today = () => new Date().toLocaleDateString('en-CA');
  const msg = (id, text) => { $(id).textContent = text || ''; };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail = (error, target='globalMessage') => msg(target, error?.message || String(error));
  function initAuthMode(next) {
    mode = next; $('nameWrap').hidden = mode !== 'signup';
    $('fullName').required = mode === 'signup';
    $('authSubmit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('showLogin').classList.toggle('active', mode === 'login');
    $('showSignup').classList.toggle('active', mode === 'signup');
    msg('authMessage','');
  }
  $('showLogin').onclick = () => initAuthMode('login');
  $('showSignup').onclick = () => initAuthMode('signup');
  $('authForm').onsubmit = async e => {
    e.preventDefault(); msg('authMessage','Please wait…');
    const phone = $('phone').value.trim(), password = $('password').value;
    try {
      if (mode === 'signup') {
        const {data,error} = await client.auth.signUp({phone,password,options:{data:{full_name:$('fullName').value.trim()}}});
        if (error) throw error;
        msg('authMessage', data.session ? 'Account created.' : 'Account created. Complete phone verification if prompted, then sign in.');
      } else {
        const {error} = await client.auth.signInWithPassword({phone,password});
        if (error) throw error;
      }
    } catch(error) { fail(error,'authMessage'); }
  };
  $('signOut').onclick = async () => { await client.auth.signOut(); location.reload(); };
  async function profile() {
    const {data:{user}} = await client.auth.getUser();
    if (!user) return null;
    const {data,error} = await client.from('profiles').select('id,full_name,phone,role').eq('id',user.id).single();
    if (error) throw error; return data;
  }
  async function start() {
    const p = await profile(); if (!p) return;
    currentProfile = p;
    $('authPanel').hidden = true; $('appPanel').hidden = false; $('signOut').hidden = false;
    $('hello').textContent = 'Hello, ' + p.full_name;
    $('roleLabel').textContent = p.role === 'admin' ? 'Administrator' : p.role === 'kitchen' ? 'Kitchen staff' : 'Customer';
    if (p.role === 'customer') { $('customerView').hidden = false; await loadCustomer(); }
    if (p.role === 'kitchen' || p.role === 'admin') { $('staffView').hidden = false; await loadStaff(); }
    if (p.role === 'admin') { $('adminView').hidden = false; await loadAdmin(); }
  }
  async function loadMenu() {
    const {data,error} = await client.from('menu_days').select('id,service_date,kitchen_note,bookings_closed,menu_items(id,name,is_available,sort_order)').eq('service_date',today()).eq('is_published',true).maybeSingle();
    if (error) throw error; todayMenu = data; return data;
  }
  async function loadCustomer() {
    $('serviceDate').textContent = today();
    const menu = await loadMenu(), area = $('menuItems');
    if (!menu) { area.textContent = 'No menu has been published yet.'; return; }
    $('serviceDate').textContent = menu.service_date + (menu.bookings_closed ? ' · Booking closed' : '');
    area.innerHTML = (menu.menu_items || []).filter(x=>x.is_available).sort((a,b)=>a.sort_order-b.sort_order).map(x=>'<label class="dish"><input type="checkbox" value="'+esc(x.name)+'" '+(menu.bookings_closed?'disabled':'')+'><span>'+esc(x.name)+'</span></label>').join('');
    const {data,error} = await client.from('orders').select('id,service_date,selected_items,total_kes,status,created_at').eq('customer_id',currentProfile.id).order('created_at',{ascending:false}).limit(12);
    if (error) throw error;
    $('myOrders').innerHTML = (data||[]).map(orderCard).join('') || '<p>No orders yet.</p>';
  }
  $('placeOrder').onclick = async () => {
    if (!todayMenu || todayMenu.bookings_closed) return msg('globalMessage','Bookings are closed for today.');
    const selected = [...$('menuItems').querySelectorAll('input:checked')].map(x=>x.value);
    if (!selected.length) return msg('globalMessage','Choose at least one dish.');
    $('placeOrder').disabled = true;
    try {
      const {error} = await client.from('orders').insert({customer_id:currentProfile.id,service_date:today(),customer_name_snapshot:currentProfile.full_name,customer_phone_snapshot:currentProfile.phone,selected_items:selected,kitchen_note:$('kitchenNote').value.trim(),unit_price_kes:50,quantity:1});
      if (error) throw error;
      msg('globalMessage','Order saved. M-Pesa checkout is not enabled until the secure Daraja function is deployed.');
      await loadCustomer();
    } catch(error) { fail(error); }
    finally { $('placeOrder').disabled = false; }
  };
  function orderCard(o) {
    return '<article class="order"><div class="order-top"><strong>'+esc(o.service_date)+'</strong><strong>KES '+esc(o.total_kes)+'</strong></div><p>'+esc((o.selected_items||[]).join(', '))+'</p><span class="muted">Status: '+esc(o.status)+'</span></article>';
  }
  async function loadStaff() {
    const {data,error} = await client.from('orders').select('*').order('created_at',{ascending:false}).limit(100);
    if (error) throw error;
    $('staffOrders').innerHTML = (data||[]).map(o=>'<article class="order"><div class="order-top"><strong>'+esc(o.customer_name_snapshot)+'</strong><strong>KES '+o.total_kes+'</strong></div><p>'+esc(o.customer_phone_snapshot)+' · '+esc(o.service_date)+'</p><p>'+esc((o.selected_items||[]).join(', '))+'</p><p>'+esc(o.kitchen_note)+'</p><label>Status<select data-order="'+o.id+'">'+['pending_payment','confirmed','preparing','ready','collected','cancelled'].map(s=>'<option '+(o.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></label></article>').join('') || '<p>No orders.</p>';
    $('staffOrders').querySelectorAll('select[data-order]').forEach(sel=>sel.onchange=async()=>{try{const {error}=await client.from('orders').update({status:sel.value}).eq('id',sel.dataset.order);if(error)throw error;msg('globalMessage','Order status updated.');}catch(e){fail(e);}});
  }
  async function loadAdmin() {
    const menu = await loadMenu();
    if (menu) { $('dishNames').value = (menu.menu_items||[]).map(x=>x.name).join('\n'); $('menuNote').value=menu.kitchen_note||''; }
    const {data,error} = await client.from('orders').select('*').order('created_at',{ascending:false}).limit(200);
    if(error)throw error; $('adminOrders').innerHTML=(data||[]).map(orderCard).join('')||'<p>No orders yet.</p>';
  }
  $('publishMenu').onclick = async () => {
    const names = [...new Set($('dishNames').value.split('\n').map(x=>x.trim()).filter(Boolean))];
    if(!names.length)return msg('globalMessage','Enter at least one dish.');
    try {
      const {data:day,error} = await client.from('menu_days').upsert({service_date:today(),kitchen_note:$('menuNote').value.trim(),is_published:true,bookings_closed:false,created_by:currentProfile.id},{onConflict:'service_date'}).select().single();
      if(error)throw error;
      const {error:delError}=await client.from('menu_items').delete().eq('menu_day_id',day.id); if(delError)throw delError;
      const {error:insertError}=await client.from('menu_items').insert(names.map((name,i)=>({menu_day_id:day.id,name,sort_order:i})));
      if(insertError)throw insertError;
      msg('globalMessage','Today’s menu published.'); await loadAdmin();
    } catch(error){fail(error);}
  };
  async function boot() {
    if (!config || !config.supabaseUrl || config.supabaseUrl.includes('YOUR_PROJECT_REF') || !config.supabaseAnonKey || config.supabaseAnonKey.includes('YOUR_SUPABASE')) { $('configWarning').hidden=false; $('authPanel').hidden=true; return; }
    client = window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
    const {data:{session}}=await client.auth.getSession();
    if(session) { try { await start(); } catch(error){fail(error);} }
    client.auth.onAuthStateChange((_event,session)=>{ if(session) start().catch(fail); });
  }
  boot().catch(fail);
})();