-- Run this entire file in Supabase > SQL Editor > New query.
create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null check (category in ('Coffee','Non-coffee','Pastries')),
  price numeric(10,2) not null check (price >= 0),
  description text not null default '',
  image text not null default '',
  tag text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.promotions (
  code text primary key,
  name text not null,
  description text not null default '',
  type text not null check (type in ('percent','coffee_pastry','two_drinks')),
  value numeric(10,2) not null check (value >= 0),
  min_spend numeric(10,2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  customer_name text not null,
  phone text not null,
  email text,
  fulfilment text not null default 'pickup' check (fulfilment in ('pickup','dine-in')),
  notes text,
  items jsonb not null,
  subtotal numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  promo_code text,
  status text not null default 'new' check (status in ('new','confirmed','preparing','ready','completed','cancelled')),
  created_at timestamptz not null default now()
);
-- Public visitors must access data only through the Netlify Function. Never expose the service-role key in browser code.
alter table public.products enable row level security;
alter table public.promotions enable row level security;
alter table public.orders enable row level security;
-- Seed sample menu and promotions. Prices/addresses are illustrative for the assignment.
insert into public.products (id,name,category,price,description,image,tag,sort_order) values
('espresso','Espresso','Coffee',7,'A short, rich shot with a smooth finish.','https://images.unsplash.com/photo-1510707577719-ae7c14805e76?auto=format&fit=crop&w=800&q=80','Classic',1),
('latte','Cafe Latte','Coffee',12,'Velvety espresso balanced with steamed milk.','https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80','Best seller',2),
('iced-americano','Iced Americano','Coffee',10,'Bright espresso poured over ice.','https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80','Refreshing',3),
('matcha','Iced Matcha','Non-coffee',13,'Earthy matcha with creamy milk and ice.','https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=800&q=80','Popular',4),
('chocolate','Iced Chocolate','Non-coffee',12,'Chocolatey, chilled and comforting.','https://images.unsplash.com/photo-1542990253-0b8be7c6c0f5?auto=format&fit=crop&w=800&q=80','Sweet',5),
('croissant','Butter Croissant','Pastries',8,'Flaky layers, baked until golden.','https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80','Fresh baked',6)
on conflict (id) do nothing;
insert into public.promotions (code,name,description,type,value,min_spend,sort_order) values
('FIRST10','First Sip','Enjoy 10% off orders above RM25.','percent',10,25,1),
('COFFEE3','Coffee & a Treat','Save RM3 when you buy any coffee and pastry together.','coffee_pastry',3,0,2),
('STUDY2','Study Break Set','Choose any two drinks and get RM2 off your order.','two_drinks',2,0,3)
on conflict (code) do nothing;
