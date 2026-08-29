-- ============================================================
-- KKTC Fantazi Lig — Supabase şeması
-- Supabase Dashboard > SQL Editor'a yapıştırıp çalıştırın.
-- ============================================================

-- ---------- PROFİLLER ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  team_name text not null default 'Takımım',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Yeni kullanıcı kaydolunca otomatik profil oluştur
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, team_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)) || '_' || substr(new.id::text, 1, 4),
    coalesce(new.raw_user_meta_data->>'team_name', 'Takımım')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- LİG VERİSİ ----------
create table if not exists teams (
  id bigint primary key,          -- Sofascore takım ID
  name text not null,
  short text not null,
  color text not null default '#374df5',   -- forma gövde rengi
  color2 text not null default '#ffffff'   -- forma kol rengi
);
-- Mevcut kurulumlar için geçiş:
-- alter table teams add column if not exists color2 text not null default '#ffffff';

create table if not exists players (
  id bigint primary key,          -- Sofascore oyuncu ID (manuel eklenenler için negatif seri kullanılabilir)
  team_id bigint not null references teams(id) on delete cascade,
  name text not null,
  pos char(1) not null check (pos in ('G','D','M','F')),
  price numeric(4,1) not null default 5.0,
  pos_guess boolean not null default false,   -- pozisyon tahmini, admin onayı bekliyor
  active boolean not null default true
);

create table if not exists gameweeks (
  id serial primary key,
  number int unique not null,
  name text not null,
  deadline timestamptz not null,
  is_current boolean not null default false,
  is_finished boolean not null default false
);

create table if not exists fixtures (
  id bigint primary key,          -- Sofascore event ID (manuel için negatif)
  gw_id int not null references gameweeks(id) on delete cascade,
  home_id bigint not null references teams(id),
  away_id bigint not null references teams(id),
  kickoff timestamptz,
  home_score int,
  away_score int,
  status text not null default 'scheduled' check (status in ('scheduled','finished','postponed'))
);

-- Oyuncu olayları: puan motorunun tek veri kaynağı.
-- 'played' olayı scraper tarafından gol atanlara otomatik, gerisi admin panelinden girilir.
create table if not exists player_events (
  id bigserial primary key,
  fixture_id bigint not null references fixtures(id) on delete cascade,
  player_id bigint not null references players(id) on delete cascade,
  event_type text not null check (event_type in
    ('played','goal','pen_goal','assist','yellow','red','own_goal','motm')),
  qty int not null default 1,
  unique (fixture_id, player_id, event_type)
);

-- ---------- FANTAZİ TAKIMLARI ----------
create table if not exists picks (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  gw_id int not null references gameweeks(id) on delete cascade,
  player_id bigint not null references players(id),
  slot int not null check (slot between 1 and 15),  -- 1-11 ilk 11, 12-15 yedek sırası
  is_captain boolean not null default false,
  is_vice boolean not null default false,
  unique (user_id, gw_id, slot),
  unique (user_id, gw_id, player_id)
);

create table if not exists gw_points (
  user_id uuid not null references profiles(id) on delete cascade,
  gw_id int not null references gameweeks(id) on delete cascade,
  points int not null default 0,
  primary key (user_id, gw_id)
);

-- Kozlar: sezonda her koz 1 kez, haftada en fazla 1 koz
create table if not exists chips (
  user_id uuid not null references profiles(id) on delete cascade,
  gw_id int not null references gameweeks(id) on delete cascade,
  chip text not null check (chip in ('bench_boost','triple_captain','wildcard','free_hit')),
  played_at timestamptz not null default now(),
  primary key (user_id, gw_id),
  constraint chips_user_id_chip unique (user_id, chip)
);

-- ---------- MİNİ LİGLER ----------
create table if not exists leagues (
  id serial primary key,
  code text unique not null,
  name text not null,
  owner_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  league_id int not null references leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- ---------- YARDIMCI FONKSİYONLAR ----------
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false)
$$;

-- ---------- PUAN MOTORU ----------
-- Puan kuralları (KKTC uyarlaması — kadro/ilk 11 verisi her maçta olmadığı için 'played'
-- kaydı admin/scraper tarafından girilir):
--   Maça çıkma: +2 | Gol: G +10, D +6, M +5, F +4 (penaltı golü dahil)
--   Asist: +3 | Gol yememe (played + takım gol yemedi): G/D +4, M +1
--   Sarı kart: -1 | Kırmızı kart: -3 | Kendi kalesine: -2 | Maçın oyuncusu: +3
create or replace function player_points_for_gw(p_gw int)
returns table (player_id bigint, pts int)
language sql stable set search_path = public as $$
  with ev as (
    select pe.player_id, pe.event_type, pe.qty, pl.pos, pe.fixture_id
    from player_events pe
    join fixtures f on f.id = pe.fixture_id and f.gw_id = p_gw
    join players pl on pl.id = pe.player_id
  ),
  clean as (  -- takımı gol yemeden bitiren ve oynayan oyuncular
    select pe.player_id, pl.pos
    from player_events pe
    join players pl on pl.id = pe.player_id
    join fixtures f on f.id = pe.fixture_id and f.gw_id = p_gw and f.status = 'finished'
    where pe.event_type = 'played'
      and ((pl.team_id = f.home_id and coalesce(f.away_score, 1) = 0)
        or (pl.team_id = f.away_id and coalesce(f.home_score, 1) = 0))
  ),
  base as (
    select e.player_id,
      sum(case e.event_type
        when 'played'    then 2 * e.qty
        when 'goal'      then (case e.pos when 'G' then 10 when 'D' then 6 when 'M' then 5 else 4 end) * e.qty
        when 'pen_goal'  then (case e.pos when 'G' then 10 when 'D' then 6 when 'M' then 5 else 4 end) * e.qty
        when 'assist'    then 3 * e.qty
        when 'yellow'    then -1 * e.qty
        when 'red'       then -3 * e.qty
        when 'own_goal'  then -2 * e.qty
        when 'motm'      then 3 * e.qty
        else 0 end)::int as pts
    from ev e group by e.player_id
  ),
  cs as (
    select c.player_id,
      sum(case when c.pos in ('G','D') then 4 when c.pos = 'M' then 1 else 0 end)::int as pts
    from clean c group by c.player_id
  )
  select coalesce(b.player_id, cs.player_id) as player_id,
         coalesce(b.pts, 0) + coalesce(cs.pts, 0) as pts
  from base b full outer join cs on cs.player_id = b.player_id
$$;

-- Bir haftanın tüm kullanıcı puanlarını hesaplar.
-- Kapsam: oto-yedek, kaptan x2, kozlar (Bench Boost, Triple Captain, Wildcard, Free Hit)
-- ve transfer cezası (ilk kadro serbest; sonra haftada 2 ücretsiz, fazlası -4;
-- Wildcard/Free Hit haftasında ceza yok; Free Hit haftası sonraki haftaların
-- transfer kıyasında referans alınmaz).
-- Sadece admin çağırabilir; admin panelindeki "Puanları Hesapla" düğmesi bunu çalıştırır.
create or replace function compute_gw_points(p_gw int)
returns int language plpgsql security definer set search_path = public as $$
declare
  affected int;
  cur_number int;
begin
  if not is_admin() then
    raise exception 'Yetkisiz: sadece admin puan hesaplayabilir';
  end if;

  select number into cur_number from gameweeks where id = p_gw;

  create temp table tmp_pp on commit drop as
    select * from player_points_for_gw(p_gw);

  create temp table tmp_played on commit drop as
    select distinct pe.player_id
    from player_events pe
    join fixtures f on f.id = pe.fixture_id and f.gw_id = p_gw
    where pe.event_type = 'played';

  create temp table tmp_chip on commit drop as
    select user_id, chip from chips where gw_id = p_gw;

  -- Transfer cezaları: referans hafta = bu haftadan önceki, kadro kaydedilmiş,
  -- Free Hit oynanmamış en yakın hafta.
  create temp table tmp_hits on commit drop as
  with ref as (
    select pk.user_id, max(g.number) as ref_number
    from picks pk
    join gameweeks g on g.id = pk.gw_id
    where g.number < cur_number
      and not exists (select 1 from chips c
                      where c.user_id = pk.user_id and c.gw_id = pk.gw_id and c.chip = 'free_hit')
    group by pk.user_id
  ),
  moved as (
    select cur.user_id, count(*) filter (where old.player_id is null) as n
    from picks cur
    join ref r on r.user_id = cur.user_id
    join gameweeks rg on rg.number = r.ref_number
    left join picks old on old.user_id = cur.user_id and old.gw_id = rg.id
                       and old.player_id = cur.player_id
    where cur.gw_id = p_gw
    group by cur.user_id
  )
  select m.user_id,
    case when tc.chip in ('wildcard','free_hit') then 0
         else greatest(0, m.n - 2) * 4 end as hit
  from moved m
  left join tmp_chip tc on tc.user_id = m.user_id;

  insert into gw_points (user_id, gw_id, points)
  select u.user_id, p_gw, u.total - coalesce(h.hit, 0)
  from (
    with user_picks as (
      select pk.user_id, pk.player_id, pk.slot, pk.is_captain, pk.is_vice,
             pl.pos,
             (tp.player_id is not null) as played,
             coalesce(pp.pts, 0) as pts
      from picks pk
      join players pl on pl.id = pk.player_id
      left join tmp_played tp on tp.player_id = pk.player_id
      left join tmp_pp pp on pp.player_id = pk.player_id
      where pk.gw_id = p_gw
    ),
    -- Bench Boost oynayanlarda 15 oyuncunun tamamı sayılır, oto-yedek yapılmaz
    starters as (
      select up.* from user_picks up
      left join tmp_chip tc on tc.user_id = up.user_id
      where up.slot <= 11 or tc.chip = 'bench_boost'
    ),
    bench as (
      select up.* from user_picks up
      left join tmp_chip tc on tc.user_id = up.user_id
      where up.slot > 11 and coalesce(tc.chip, '') <> 'bench_boost'
    ),
    subs as (
      select s.user_id, s.player_id as out_id,
        (select b.player_id from bench b
         where b.user_id = s.user_id and b.played
           and ((s.pos = 'G' and b.pos = 'G') or (s.pos <> 'G' and b.pos <> 'G'))
           and b.player_id not in (
             select s2.player_id from starters s2 where s2.user_id = s.user_id and s2.played
           )
         order by b.slot
         limit 1) as in_id
      from starters s where not s.played
    ),
    numbered_subs as (
      select user_id, out_id, in_id,
        row_number() over (partition by user_id, in_id order by out_id) as rn
      from subs where in_id is not null
    ),
    effective as (
      select s.user_id,
        coalesce(ns.in_id, s.player_id) as player_id,
        s.is_captain, s.is_vice
      from starters s
      left join numbered_subs ns on ns.user_id = s.user_id and ns.out_id = s.player_id and ns.rn = 1
    ),
    scored as (
      select e.user_id, e.player_id, e.is_captain, e.is_vice,
        coalesce(pp.pts, 0) as pts,
        exists(select 1 from tmp_played tp where tp.player_id = e.player_id) as eff_played
      from effective e
      left join tmp_pp pp on pp.player_id = e.player_id
    ),
    cap as (  -- kaptan oynamadıysa vekil çarpan alır; Triple Captain'da çarpan 3'tür
      select sc.user_id,
        case when bool_or(sc.is_captain and sc.eff_played) then 'C'
             when bool_or(sc.is_vice and sc.eff_played) then 'V'
             else null end as mult_who,
        case when max(tc.chip) = 'triple_captain' then 3 else 2 end as mult
      from scored sc
      left join tmp_chip tc on tc.user_id = sc.user_id
      group by sc.user_id
    )
    select sc.user_id,
      sum(sc.pts
        + case when (sc.is_captain and c.mult_who = 'C') or (sc.is_vice and c.mult_who = 'V')
               then sc.pts * (c.mult - 1) else 0 end)::int as total
    from scored sc
    join cap c on c.user_id = sc.user_id
    group by sc.user_id
  ) u
  left join tmp_hits h on h.user_id = u.user_id
  on conflict (user_id, gw_id) do update set points = excluded.points;

  get diagnostics affected = row_count;
  update gameweeks set is_finished = true where id = p_gw;
  return affected;
end $$;

-- ---------- GÖRÜNÜMLER ----------
create or replace view standings as
  select p.id as user_id, p.username, p.team_name,
         coalesce(sum(g.points), 0)::int as total_points
  from profiles p
  left join gw_points g on g.user_id = p.id
  group by p.id, p.username, p.team_name
  order by total_points desc;

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table gameweeks enable row level security;
alter table fixtures enable row level security;
alter table player_events enable row level security;
alter table picks enable row level security;
alter table chips enable row level security;
alter table gw_points enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;

-- Herkes okuyabilir (anon dahil — vitrin sayfaları için)
create policy "read all" on teams for select using (true);
create policy "read all" on players for select using (true);
create policy "read all" on gameweeks for select using (true);
create policy "read all" on fixtures for select using (true);
create policy "read all" on player_events for select using (true);
create policy "read all" on gw_points for select using (true);
create policy "read all" on profiles for select using (true);
create policy "read all" on leagues for select using (true);
create policy "read all" on league_members for select using (true);
create policy "read all" on picks for select using (true);

-- Profil: kendi satırını güncelleyebilir (is_admin hariç)
create policy "update own profile" on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and is_admin = (select is_admin from profiles where id = auth.uid()));

-- Lig verisi: sadece admin yazar
create policy "admin write" on teams for all using (is_admin()) with check (is_admin());
create policy "admin write" on players for all using (is_admin()) with check (is_admin());
create policy "admin write" on gameweeks for all using (is_admin()) with check (is_admin());
create policy "admin write" on fixtures for all using (is_admin()) with check (is_admin());
create policy "admin write" on player_events for all using (is_admin()) with check (is_admin());

-- Kadro: kendi kadrosunu, sadece deadline geçmeden yazabilir
create policy "write own picks" on picks for insert
  with check (auth.uid() = user_id and
    (select deadline from gameweeks where id = gw_id) > now());
create policy "update own picks" on picks for update
  using (auth.uid() = user_id and
    (select deadline from gameweeks where id = gw_id) > now());
create policy "delete own picks" on picks for delete
  using (auth.uid() = user_id and
    (select deadline from gameweeks where id = gw_id) > now());

-- Kozlar: kendi kozunu, sadece deadline geçmeden oyna/iptal et
create policy "read all" on chips for select using (true);
create policy "play own chip" on chips for insert
  with check (auth.uid() = user_id and
    (select deadline from gameweeks where id = gw_id) > now());
create policy "cancel own chip" on chips for delete
  using (auth.uid() = user_id and
    (select deadline from gameweeks where id = gw_id) > now());

-- Mini ligler
create policy "create league" on leagues for insert with check (auth.uid() = owner_id);
create policy "owner update league" on leagues for update using (auth.uid() = owner_id);
create policy "owner delete league" on leagues for delete using (auth.uid() = owner_id);
create policy "join league" on league_members for insert with check (auth.uid() = user_id);
create policy "leave league" on league_members for delete using (auth.uid() = user_id);

-- İlk admin ataması (kendi e-postanızla değiştirin ve SQL Editor'dan çalıştırın):
-- update profiles set is_admin = true
--   where id = (select id from auth.users where email = 'cemal.basaranel@gmail.com');
