-- Run once in a NEW Supabase project, in SQL Editor.
begin;
create schema if not exists student_private;
revoke all on schema student_private from public, anon, authenticated;
create table if not exists student_private.admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists student_private.settings (singleton boolean primary key default true check(singleton), require_code boolean not null default true);
insert into student_private.settings(singleton) values(true) on conflict do nothing;
create table if not exists student_private.students (
 student_id text primary key check(student_id ~ '^[0-9]{1,20}$'),
 full_name text not null check(char_length(full_name) between 1 and 200),
 room text not null check(char_length(room) between 1 and 40),
 seat_no integer check(seat_no between 1 and 999),
 access_code text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),
 created_at timestamptz not null default now()
);
create table if not exists student_private.submissions (
 student_id text primary key references student_private.students(student_id) on delete cascade,
 nickname text not null check(char_length(nickname) between 1 and 60),
 phone text not null check(phone ~ '^0[0-9]{9}$'),
 photo_base64 text not null check(char_length(photo_base64) between 16 and 409600),
 submitted_at timestamptz not null default now()
);
alter table student_private.admins enable row level security;
alter table student_private.settings enable row level security;
alter table student_private.students enable row level security;
alter table student_private.submissions enable row level security;
revoke all on all tables in schema student_private from public, anon, authenticated;

create or replace function student_private.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from student_private.admins a where a.user_id=auth.uid()) then raise exception 'ADMIN_REQUIRED'; end if;
end; $$;
revoke all on function student_private.require_admin() from public, anon, authenticated;

create or replace function public.sp_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('require_code',require_code) from student_private.settings where singleton;
$$;
create or replace function public.sp_lookup(p_id text,p_code text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare s student_private.students%rowtype; need_code boolean;
begin
 select require_code into need_code from student_private.settings where singleton;
 select * into s from student_private.students where student_id=trim(p_id) and (not need_code or access_code=upper(trim(coalesce(p_code,''))));
 if not found then return null; end if;
 return jsonb_build_object('student_id',s.student_id,'full_name',s.full_name,'room',s.room,'submitted',exists(select 1 from student_private.submissions where student_id=s.student_id));
end; $$;
create or replace function public.sp_submit(p_id text,p_code text,p_nickname text,p_phone text,p_photo text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s student_private.students%rowtype; need_code boolean; photo_bytes bytea;
begin
 select require_code into need_code from student_private.settings where singleton;
 select * into s from student_private.students where student_id=trim(p_id) and (not need_code or access_code=upper(trim(coalesce(p_code,''))));
 if not found then raise exception 'INVALID_STUDENT'; end if;
 if p_nickname is null or char_length(trim(p_nickname)) not between 1 and 60 or p_phone is null or p_phone !~ '^0[0-9]{9}$' then raise exception 'INVALID_FIELDS'; end if;
 if p_photo is null or char_length(p_photo) not between 16 and 409600 then raise exception 'INVALID_PHOTO'; end if;
 begin photo_bytes:=decode(p_photo,'base64'); exception when others then raise exception 'INVALID_PHOTO'; end;
 if octet_length(photo_bytes) > 307200 or substring(photo_bytes from 1 for 3) <> decode('ffd8ff','hex') or substring(photo_bytes from octet_length(photo_bytes)-1 for 2) <> decode('ffd9','hex') then raise exception 'INVALID_PHOTO'; end if;
 insert into student_private.submissions(student_id,nickname,phone,photo_base64) values(s.student_id,trim(p_nickname),p_phone,p_photo) on conflict(student_id) do nothing;
 if not found then return jsonb_build_object('submitted',true,'already',true); end if;
 return jsonb_build_object('submitted',true,'already',false);
end; $$;

create or replace function public.sp_admin_check() returns boolean language plpgsql security definer set search_path='' as $$ begin perform student_private.require_admin(); return true; end; $$;
create or replace function public.sp_admin_report() returns table(student_id text,full_name text,room text,seat_no integer,nickname text,phone text,submitted_at timestamptz) language plpgsql security definer set search_path='' as $$
begin perform student_private.require_admin(); return query select s.student_id,s.full_name,s.room,s.seat_no,t.nickname,t.phone,t.submitted_at from student_private.students s left join student_private.submissions t on t.student_id=s.student_id order by s.room,s.seat_no nulls last,s.student_id; end; $$;
create or replace function public.sp_admin_photo(p_id text) returns text language plpgsql security definer set search_path='' as $$
declare photo text; begin perform student_private.require_admin(); select photo_base64 into photo from student_private.submissions where student_id=p_id; return photo; end; $$;
create or replace function public.sp_admin_codes() returns table(student_id text,full_name text,room text,seat_no integer,access_code text) language plpgsql security definer set search_path='' as $$
begin perform student_private.require_admin(); return query select s.student_id,s.full_name,s.room,s.seat_no,s.access_code from student_private.students s order by s.room,s.seat_no nulls last,s.student_id; end; $$;
create or replace function public.sp_admin_import(p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin perform student_private.require_admin();
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'INVALID_IMPORT'; end if;
 insert into student_private.students(student_id,full_name,room,seat_no)
 select trim(r.student_id),trim(r.full_name),trim(r.room),r.seat_no from jsonb_to_recordset(p_rows) as r(student_id text,full_name text,room text,seat_no integer)
 on conflict(student_id) do update set full_name=excluded.full_name,room=excluded.room,seat_no=excluded.seat_no;
 get diagnostics n=row_count; return n;
end; $$;
create or replace function public.sp_admin_reset(p_id text) returns boolean language plpgsql security definer set search_path='' as $$
begin perform student_private.require_admin(); delete from student_private.submissions where student_id=p_id; return found; end; $$;

revoke all on function public.sp_settings(),public.sp_lookup(text,text),public.sp_submit(text,text,text,text,text),public.sp_admin_check(),public.sp_admin_report(),public.sp_admin_photo(text),public.sp_admin_codes(),public.sp_admin_import(jsonb),public.sp_admin_reset(text) from public,anon,authenticated;
grant execute on function public.sp_settings(),public.sp_lookup(text,text),public.sp_submit(text,text,text,text,text) to anon,authenticated;
grant execute on function public.sp_admin_check(),public.sp_admin_report(),public.sp_admin_photo(text),public.sp_admin_codes(),public.sp_admin_import(jsonb),public.sp_admin_reset(text) to authenticated;
commit;
-- After creating Admin in Authentication > Users, run separately (using the preconfigured internal email):
-- insert into student_private.admins(user_id) select id from auth.users where email='student-admin@example.com' on conflict do nothing;
-- Optional ID-only mode (NOT recommended for real student data):
-- update student_private.settings set require_code=false where singleton;
