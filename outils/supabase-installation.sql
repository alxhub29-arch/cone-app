-- CŌNE : base de données de l'app (à coller une seule fois dans Supabase › SQL Editor › Run)
create table if not exists public.membres(
  user_id uuid primary key references auth.users on delete cascade,
  email text, nom text,
  role text not null default 'attente' check (role in ('patron','ouvrier','attente')),
  cree timestamptz not null default now());
create table if not exists public.docs(
  col text not null, id text not null, data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (col, id));
create index if not exists docs_updated_at on public.docs(updated_at);

create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at = clock_timestamp(); new.updated_by = auth.uid(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.touch();

create or replace function public.mon_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.membres where user_id = auth.uid() $$;

-- chaque nouvel accès devient un membre : le tout premier est le patron, les suivants attendent sa validation
create or replace function public.nouveau_membre() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.membres(user_id, email, nom, role) values (new.id, new.email, new.raw_user_meta_data->>'nom',
    case when exists (select 1 from public.membres where role = 'patron') then 'attente' else 'patron' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.nouveau_membre();

alter table public.docs enable row level security;
alter table public.membres enable row level security;
drop policy if exists patron_docs on public.docs;
drop policy if exists ouvrier_lire on public.docs;
drop policy if exists ouvrier_ecrire on public.docs;
drop policy if exists ouvrier_modif on public.docs;
create policy patron_docs on public.docs for all to authenticated using (public.mon_role() = 'patron') with check (public.mon_role() = 'patron');
create policy ouvrier_lire on public.docs for select to authenticated using (public.mon_role() = 'ouvrier' and col in ('equipe/missions/items','equipe/rapports/items'));
create policy ouvrier_ecrire on public.docs for insert to authenticated with check (public.mon_role() = 'ouvrier' and col = 'equipe/rapports/items');
create policy ouvrier_modif on public.docs for update to authenticated using (public.mon_role() = 'ouvrier' and col = 'equipe/rapports/items') with check (public.mon_role() = 'ouvrier' and col = 'equipe/rapports/items');
drop policy if exists membres_lire on public.membres;
drop policy if exists membres_patron on public.membres;
drop policy if exists membres_patron_del on public.membres;
create policy membres_lire on public.membres for select to authenticated using (user_id = auth.uid() or public.mon_role() = 'patron');
create policy membres_patron on public.membres for update to authenticated using (public.mon_role() = 'patron') with check (public.mon_role() = 'patron');
create policy membres_patron_del on public.membres for delete to authenticated using (public.mon_role() = 'patron');
grant execute on function public.mon_role() to authenticated;

insert into storage.buckets(id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists cone_photos_lire on storage.objects;
drop policy if exists cone_photos_ajout on storage.objects;
drop policy if exists cone_photos_maj on storage.objects;
drop policy if exists cone_photos_suppr on storage.objects;
create policy cone_photos_lire on storage.objects for select to authenticated using (bucket_id = 'photos' and public.mon_role() in ('patron','ouvrier'));
create policy cone_photos_ajout on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.mon_role() in ('patron','ouvrier'));
create policy cone_photos_maj on storage.objects for update to authenticated using (bucket_id = 'photos' and public.mon_role() in ('patron','ouvrier'));
create policy cone_photos_suppr on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.mon_role() = 'patron');
