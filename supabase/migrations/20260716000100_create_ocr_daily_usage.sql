create table if not exists public.ocr_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  image_count integer not null default 0 check (image_count >= 0),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.ocr_daily_usage enable row level security;
revoke all on table public.ocr_daily_usage from anon, authenticated;

create or replace function public.reserve_ocr_quota(
  p_user_id uuid,
  p_image_count integer,
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_date date := (timezone('utc', now()))::date;
  new_count integer;
  current_count integer;
begin
  if p_user_id is null or p_image_count < 1 or p_image_count > p_limit or p_limit < 1 then
    raise exception 'invalid quota reservation';
  end if;

  insert into public.ocr_daily_usage (user_id, usage_date, image_count, request_count, updated_at)
  values (p_user_id, quota_date, p_image_count, 1, now())
  on conflict (user_id, usage_date) do update
    set image_count = public.ocr_daily_usage.image_count + excluded.image_count,
        request_count = public.ocr_daily_usage.request_count + 1,
        updated_at = now()
    where public.ocr_daily_usage.image_count + excluded.image_count <= p_limit
  returning image_count into new_count;

  if new_count is null then
    select image_count into current_count
    from public.ocr_daily_usage
    where user_id = p_user_id and usage_date = quota_date;

    return jsonb_build_object(
      'allowed', false,
      'used', coalesce(current_count, 0),
      'limit', p_limit,
      'remaining', greatest(p_limit - coalesce(current_count, 0), 0)
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', new_count,
    'limit', p_limit,
    'remaining', greatest(p_limit - new_count, 0)
  );
end;
$$;

revoke all on function public.reserve_ocr_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_ocr_quota(uuid, integer, integer) to service_role;
