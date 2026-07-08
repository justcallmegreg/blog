import {
  SESv2Client,
  ListContactsCommand,
  GetContactCommand,
  DeleteContactCommand,
} from '@aws-sdk/client-sesv2';
import type { Subscriber, SubscriptionStatus } from './types';

export interface SesConfig {
  region: string;
  contactList: string;
  topic: string;
}

export function sesConfigFromEnv(): SesConfig {
  return {
    region: process.env.AWS_REGION || 'eu-central-1',
    contactList: process.env.SES_CONTACT_LIST || 'blog-subscribers',
    topic: process.env.SES_TOPIC || 'weekly-digest',
  };
}

/** Minimal shape of an AWS SDK v3 client — lets tests inject a fake. */
export interface SesLike {
  send(command: unknown): Promise<any>;
}

function makeClient(cfg: SesConfig): SesLike {
  return new SESv2Client({ region: cfg.region });
}

function toIso(ts: unknown): string {
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).toISOString();
  return new Date(0).toISOString();
}

function effectiveStatus(contact: any, topic: string): SubscriptionStatus {
  const pref = (contact.TopicPreferences ?? []).find((p: any) => p.TopicName === topic);
  if (pref) return pref.SubscriptionStatus === 'OPT_OUT' ? 'OPT_OUT' : 'OPT_IN';
  const def = (contact.TopicDefaultPreferences ?? []).find((p: any) => p.TopicName === topic);
  if (def) return def.SubscriptionStatus === 'OPT_OUT' ? 'OPT_OUT' : 'OPT_IN';
  return 'OPT_IN';
}

/** All contacts in the list, each enriched with its true created date + status. */
export async function listSubscribers(
  cfg: SesConfig,
  client: SesLike = makeClient(cfg)
): Promise<Subscriber[]> {
  const emails: string[] = [];
  let token: string | undefined;
  do {
    const page: any = await client.send(
      new ListContactsCommand({ ContactListName: cfg.contactList, PageSize: 100, NextToken: token })
    );
    for (const c of page.Contacts ?? []) if (c.EmailAddress) emails.push(c.EmailAddress);
    token = page.NextToken;
  } while (token);

  const subs: Subscriber[] = [];
  for (const email of emails) {
    const c: any = await client.send(
      new GetContactCommand({ ContactListName: cfg.contactList, EmailAddress: email })
    );
    subs.push({ email, createdAt: toIso(c.CreatedTimestamp), status: effectiveStatus(c, cfg.topic) });
  }
  return subs;
}

/** Permanently remove a contact from the list. */
export async function deleteSubscriber(
  cfg: SesConfig,
  email: string,
  client: SesLike = makeClient(cfg)
): Promise<void> {
  await client.send(new DeleteContactCommand({ ContactListName: cfg.contactList, EmailAddress: email }));
}
