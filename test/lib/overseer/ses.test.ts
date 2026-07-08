import { describe, it, expect } from 'vitest';
import { listSubscribers, deleteSubscriber, type SesLike } from '../../../src/lib/overseer/ses';

const cfg = { region: 'eu-central-1', contactList: 'blog-subscribers', topic: 'weekly-digest' };

function fakeClient(handlers: Record<string, (cmd: any) => any>): SesLike {
  return { send: (cmd: any) => Promise.resolve(handlers[cmd.constructor.name]?.(cmd) ?? {}) };
}

describe('listSubscribers', () => {
  it('paginates ListContacts and enriches each with GetContact date + status', async () => {
    let listCalls = 0;
    const client = fakeClient({
      ListContactsCommand: () => {
        listCalls += 1;
        return listCalls === 1
          ? { Contacts: [{ EmailAddress: 'a@x.co' }], NextToken: 'p2' }
          : { Contacts: [{ EmailAddress: 'b@x.co' }] };
      },
      GetContactCommand: (cmd) => ({
        CreatedTimestamp: new Date('2026-07-01T00:00:00.000Z'),
        TopicPreferences:
          cmd.input.EmailAddress === 'b@x.co'
            ? [{ TopicName: 'weekly-digest', SubscriptionStatus: 'OPT_OUT' }]
            : [{ TopicName: 'weekly-digest', SubscriptionStatus: 'OPT_IN' }],
      }),
    });
    const subs = await listSubscribers(cfg, client);
    expect(subs.map((s) => s.email)).toEqual(['a@x.co', 'b@x.co']);
    expect(subs[0].status).toBe('OPT_IN');
    expect(subs[1].status).toBe('OPT_OUT');
    expect(subs[0].createdAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('falls back to the list default status when no explicit topic preference', async () => {
    const client = fakeClient({
      ListContactsCommand: () => ({ Contacts: [{ EmailAddress: 'a@x.co' }] }),
      GetContactCommand: () => ({
        CreatedTimestamp: new Date('2026-07-01T00:00:00.000Z'),
        TopicDefaultPreferences: [{ TopicName: 'weekly-digest', SubscriptionStatus: 'OPT_OUT' }],
      }),
    });
    const subs = await listSubscribers(cfg, client);
    expect(subs[0].status).toBe('OPT_OUT');
  });
});

describe('deleteSubscriber', () => {
  it('issues DeleteContact with the list + email', async () => {
    const sent: any[] = [];
    const client: SesLike = { send: (cmd: any) => { sent.push(cmd); return Promise.resolve({}); } };
    await deleteSubscriber(cfg, 'a@x.co', client);
    expect(sent[0].constructor.name).toBe('DeleteContactCommand');
    expect(sent[0].input).toMatchObject({ ContactListName: 'blog-subscribers', EmailAddress: 'a@x.co' });
  });
});
