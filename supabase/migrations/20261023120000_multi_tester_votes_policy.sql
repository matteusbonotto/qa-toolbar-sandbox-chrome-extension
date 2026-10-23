begin;

-- Multi Testador fase 2 (docs/adr/0003-multi-testador-sessao-colaborativa.md, "Fase MT2"): consensus
-- before the host's risky clicks/submits. The vote events decide whether an action runs, so, like
-- chat, they are published ONLY by the multi-tester Edge Function with the sender stamped from the
-- verified JWT (actions vote-request, vote, vote-result). A member with a custom client therefore
-- cannot forge another tester's approval: the insert policy now rejects client `chat`, `vote`,
-- `vote-request` and `vote-result`. Proposals, cursors and clicks stay peer-to-peer (they only
-- inform; the host still has to act himself).
drop policy if exists "mt members send room channel" on realtime.messages;
create policy "mt members send room channel" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and coalesce(realtime.messages.event, '') not in ('chat', 'vote', 'vote-request', 'vote-result') and public.mt_can_use_channel(realtime.topic()));

commit;
