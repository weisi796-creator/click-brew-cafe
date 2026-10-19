import crypto from 'node:crypto';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (statusCode, body, extraHeaders={}) => ({ statusCode, headers: {...headers, ...extraHeaders}, body: JSON.stringify(body) });
const env = (key) => process.env[key] || '';
const dbReady = () => Boolean(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY'));
const base = () => env('SUPABASE_URL').replace(/\/$/, '') + '/rest/v1';
async function db(table, {method='GET', query='', body, prefer}={}) {
  if (!dbReady()) throw new Error('Database is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.');
  const res = await fetch(`${base()}/${table}${query ? '?' + query : ''}`, {
    method,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
      ...(prefer ? {Prefer: prefer} : {})
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {})
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data && typeof data === 'object' ? (data.message || data.details || data.hint || data.error) : data;
    throw new Error(message || `Database request failed (${res.status})`);
  }
  return data;
}
function sign(value) { return crypto.createHmac('sha256', env('SESSION_SECRET')).update(value).digest('hex'); }
function tokenFor(exp) { const value=String(exp); return `${value}.${sign(value)}`; }
function isAdmin(event) {
  if (!env('SESSION_SECRET')) return false;
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  const match = cookie.match(/cb_admin=([^;]+)/); if (!match) return false;
  const parts = decodeURIComponent(match[1]).split('.'); if (parts.length !== 2) return false;
  const [exp, signature] = parts; if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
}
const cookieHeaders = (value) => ({'Set-Cookie': value});
function requireAdmin(event) { if (!isAdmin(event)) return json(401, {error:'Please sign in to the admin dashboard.'}); return null; }
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return {statusCode:204, headers:{...headers,'Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Access-Control-Allow-Headers':'Content-Type'},body:''};
  const action = event.queryStringParameters?.action || '';
  let input={}; try { input = event.body ? JSON.parse(event.body) : {}; } catch { return json(400,{error:'Invalid JSON body.'}); }
  try {
    if (action === 'health') return json(200,{ok:true,databaseConfigured:dbReady()});
    if (action === 'catalog' && event.httpMethod === 'GET') {
      if (!dbReady()) return json(503,{error:'Database is not configured.'});
      const [products,promotions] = await Promise.all([
        db('products',{query:'select=id,name,category,price,description,image,tag,active&active=eq.true&order=sort_order.asc'}),
        db('promotions',{query:'select=code,name,description,type,value,min_spend,active&active=eq.true&order=sort_order.asc'})
      ]);
      return json(200,{products,promotions});
    }
    if (action === 'orders' && event.httpMethod === 'POST') {
      if (!dbReady()) return json(503,{error:'Orders cannot be saved yet: database is not configured.'});
      const {customer_name,phone,email,fulfilment,notes,items,promo_code} = input;
      if (!customer_name?.trim() || !phone?.trim() || !Array.isArray(items) || !items.length) return json(400,{error:'Please provide your name, phone number and at least one item.'});
      if (customer_name.length>120 || phone.length>40 || (email||'').length>180 || (notes||'').length>1000) return json(400,{error:'One or more fields are too long.'});
      // Recalculate prices and totals on the server; never trust totals submitted by the browser.
      const ids=[...new Set(items.map(x=>String(x.product_id||'')))];
      const products=await db('products',{query:`select=id,name,category,price,active&id=in.(${ids.map(x=>encodeURIComponent(x)).join(',')})&active=eq.true`});
      const byId=new Map(products.map(p=>[String(p.id),p]));
      const checked=[]; for(const item of items){const p=byId.get(String(item.product_id||''));const quantity=Number(item.quantity);if(!p||!Number.isInteger(quantity)||quantity<1||quantity>30)return json(400,{error:'An item is unavailable or has an invalid quantity. Please refresh the menu.'});checked.push({product_id:p.id,name:p.name,price:Number(p.price),quantity});}
      const subtotal=checked.reduce((s,x)=>s+x.price*x.quantity,0);
      let discount=0;
      if(promo_code){const promoRows=await db('promotions',{query:`select=code,type,value,min_spend,active&code=eq.${encodeURIComponent(String(promo_code))}&active=eq.true&limit=1`});const promo=promoRows[0];if(promo){if(promo.type==='percent'&&subtotal>=Number(promo.min_spend||0))discount=subtotal*Number(promo.value)/100;else if(promo.type==='coffee_pastry'&&checked.some(x=>products.find(p=>String(p.id)===String(x.product_id))?.category==='Coffee')&&checked.some(x=>products.find(p=>String(p.id)===String(x.product_id))?.category==='Pastries'))discount=Number(promo.value);else if(promo.type==='two_drinks'&&checked.filter(x=>['Coffee','Non-coffee'].includes(products.find(p=>String(p.id)===String(x.product_id))?.category)).reduce((s,x)=>s+x.quantity,0)>=2)discount=Number(promo.value);}}
      discount=Math.min(subtotal,discount);const orderNumber='CB-'+Date.now().toString().slice(-8);
      const rows=await db('orders',{method:'POST',query:'select=id,order_number,created_at',body:{order_number:orderNumber,customer_name:customer_name.trim(),phone:phone.trim(),email:email?.trim()||null,fulfilment:fulfilment==='dine-in'?'dine-in':'pickup',notes:notes?.trim()||null,items:checked,subtotal:Number(subtotal.toFixed(2)),discount:Number(discount.toFixed(2)),total:Number((subtotal-discount).toFixed(2)),promo_code:promo_code||null,status:'new'},prefer:'return=representation'});
      return json(201,{ok:true,order_number:rows?.[0]?.order_number||orderNumber});
    }
    if (action === 'admin-login' && event.httpMethod === 'POST') {
      if (!env('ADMIN_PASSWORD') || !env('SESSION_SECRET')) return json(503,{error:'Set ADMIN_PASSWORD and SESSION_SECRET in Netlify environment variables first.'});
      const sent=String(input.password||'');const expected=env('ADMIN_PASSWORD');let ok=false;
      try {const a=crypto.createHash('sha256').update(sent).digest();const b=crypto.createHash('sha256').update(expected).digest();ok=crypto.timingSafeEqual(a,b);}catch{}
      if(!ok)return json(401,{error:'Incorrect password.'});
      const exp=Date.now()+8*60*60*1000;return json(200,{ok:true},cookieHeaders(`cb_admin=${encodeURIComponent(tokenFor(exp))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`));
    }
    if (action === 'admin-logout' && event.httpMethod === 'POST') return json(200,{ok:true},cookieHeaders('cb_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'));
    if (action.startsWith('admin-')) { const denied=requireAdmin(event);if(denied)return denied; }
    if (action === 'admin-orders' && event.httpMethod === 'GET') {
      const rows=await db('orders',{query:'select=*&order=created_at.desc&limit=200'});return json(200,{orders:rows});
    }
    if (action === 'admin-update-order' && event.httpMethod === 'POST') {
      const allowed=['new','confirmed','preparing','ready','completed','cancelled'];if(!allowed.includes(input.status))return json(400,{error:'Invalid order status.'});
      const rows=await db('orders',{method:'PATCH',query:`id=eq.${encodeURIComponent(String(input.id))}&select=id,status`,body:{status:input.status},prefer:'return=representation'});return json(200,{order:rows?.[0]});
    }
    if (action === 'admin-products' && event.httpMethod === 'GET') return json(200,{products:await db('products',{query:'select=*&order=sort_order.asc'})});
    if (action === 'admin-update-product' && event.httpMethod === 'POST') {
      const id=String(input.id||'');const price=Number(input.price);if(!id||!Number.isFinite(price)||price<0||price>10000)return json(400,{error:'Enter a valid product and price.'});
      const rows=await db('products',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&select=id,name,price,active`,body:{price:Number(price.toFixed(2)),active:Boolean(input.active)},prefer:'return=representation'});return json(200,{product:rows?.[0]});
    }
    return json(404,{error:'Unknown action.'});
  } catch (error) { console.error('API error:',error.message);return json(500,{error:error.message||'Unexpected server error.'}); }
};
