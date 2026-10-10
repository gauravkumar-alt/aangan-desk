-- Aangan front desk — production storage. Service-role key only (server side); RLS on, no policies.

create table if not exists enquiries (
  id            text primary key,
  vaani_call_id text unique,            -- one enquiry per Vaani call: a second insert for the same call is impossible
  phone         text,
  source        text not null,
  created_at    timestamptz not null,
  data          jsonb not null
);
create index if not exists enquiries_phone_created on enquiries (phone, created_at desc);
create index if not exists enquiries_created on enquiries (created_at desc);

-- Webhook inbox: the idempotency key is the primary key, so retried deliveries are no-ops.
create table if not exists webhook_events (
  key          text primary key,
  status       text not null,
  received_at  timestamptz not null,
  data         jsonb not null
);
create index if not exists webhook_events_received on webhook_events (received_at desc);

create table if not exists settings (
  id   int primary key default 1 check (id = 1),
  data jsonb not null
);

alter table enquiries enable row level security;
alter table webhook_events enable row level security;
alter table settings enable row level security;
