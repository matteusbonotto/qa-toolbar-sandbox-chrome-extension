begin;

select plan(8);

select has_table('public', 'roles', 'roles exists');
select has_table('public', 'subscriptions', 'subscriptions exists');
select has_table('public', 'webhook_events', 'webhook events exists');
select has_table('public', 'license_keys', 'license keys exists');
select policies_are('public', 'subscriptions', array[]::text[], 'subscriptions are Edge-only');
select policies_are('public', 'payment_customers', array[]::text[], 'customers are Edge-only');
select policies_are('public', 'license_keys', array[]::text[], 'license hashes have no client policies');
select policies_are('public', 'webhook_events', array[]::text[], 'webhook events have no client policies');

select * from finish();
rollback;
