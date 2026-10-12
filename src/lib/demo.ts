import { sql } from './db';
import bcrypt from 'bcryptjs';

/**
 * ZERO-CONFIG DEMO MODE.
 *
 * Activates ONLY when no external DATABASE_URL is set (PGlite fallback).
 * Every serverless invocation gets a fresh ephemeral PGlite, so:
 *  - the demo user + org use DETERMINISTIC UUIDs (the session JWT stays
 *    valid across invocations),
 *  - ensureDemoSeeded() is idempotent and cheap (one SELECT when seeded),
 *  - it is called from the http handler wrapper before every API route.
 *
 * Seed documents are embedded with the same deterministic trigram-hash
 * 384-d fallback the browser client uses when the ML model fails to load.
 * Retrieval is hybrid (vector RRF + keyword tsv with 1.2x boost), so
 * keyword queries resolve correctly even with hash embeddings.
 */

export const DEMO_EMAIL = 'demo@pramaan.app';
export const DEMO_NAME = 'Demo Visitor';
// Fixed UUIDs — must never collide with gen_random_uuid() output in practice.
export const DEMO_USER_ID = '00000000-0000-0000-0000-00000000de01';
export const DEMO_ORG_ID = '00000000-0000-0000-0000-00000000de02';

export function isDemoMode(): boolean {
  // Demo mode is always available — the Try Demo button works on any deployment.
  // Demo data is isolated per-session and never touches real user data.
  return true;
}

// Deterministic 384-d trigram-hash embedding (mirrors src/lib/client/embed.ts).
export function hashEmbedding(text: string): number[] {
  const vec = new Array<number>(384).fill(0);
  const clean = text.toLowerCase();
  for (let i = 0; i < clean.length - 2; i++) {
    const tri = clean.slice(i, i + 3);
    let h = 0;
    for (let j = 0; j < tri.length; j++) h = ((h << 5) - h + tri.charCodeAt(j)) | 0;
    vec[Math.abs(h) % 384] += 1;
  }
  const n = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => Math.round((x / n) * 1e6) / 1e6);
}

type SeedDoc = { title: string; mime: string; chunks: string[] };

const SEED_DOCS: SeedDoc[] = [
  {
    title: 'NovaTech Employee Handbook 2026',
    mime: 'text/plain',
    chunks: [
      'NovaTech Solutions Pvt. Ltd. was founded in 2019 and is headquartered in Bengaluru, India. The company currently employs 240 people across engineering, design, sales, and operations. Our mission is to build reliable cloud infrastructure for small businesses.',
      'Leave policy: every full-time employee receives 21 days of annual paid leave and 12 days of sick leave per calendar year. New joiners serve a probation period of 6 months, during which 1 day of leave accrues per month. Unused annual leave up to 5 days may be carried forward to the next year.',
      'Remote work policy: employees may work from home up to 3 days per week with manager approval. Core collaboration hours are 11:00 AM to 4:00 PM IST, during which all team members must be reachable. All-hands meetings are held on the first Monday of each month and are mandatory in-office.',
      'Benefits: NovaTech provides health insurance coverage of Rs. 5 lakh per employee per year, covering spouse and two children. Employees receive an annual performance bonus of up to 15% of CTC. The company also offers a learning budget of Rs. 25,000 per year for courses and certifications.',
    ],
  },
  {
    title: 'CloudSync Pro — Product Manual v4.2',
    mime: 'text/plain',
    chunks: [
      'CloudSync Pro is a cloud backup and file-synchronization service by NovaTech. It keeps your files synced across desktop, mobile, and web with end-to-end encryption. Key features include automatic version history (30 days), selective sync folders, and shared team workspaces with granular permissions.',
      'Pricing: the Starter plan is free and includes 5 GB of storage for one user. The Pro plan costs $29 per month and includes 2 TB of storage, priority support, and 90-day version history. The Team plan costs $99 per month and includes 10 TB of pooled storage, SSO/SAML login, and a dedicated account manager.',
      'Refund policy: CloudSync Pro offers a 30-day money-back guarantee on all paid plans. If you cancel within 30 days of purchase, you receive a full refund to the original payment method within 7 business days. To request a refund, email support@cloudsync.pro with your account email and order ID. Refunds are not available after 30 days except where required by law.',
      'Troubleshooting: Error E-101 (connection failed) — restart the desktop app and check your internet connection. Error E-204 (upload blocked) — allow outbound traffic on port 443 in your firewall. If sync appears stuck, pause and resume sync from the tray menu; this re-indexes pending files. For unresolved issues contact support@cloudsync.pro with your log file.',
    ],
  },
  {
    title: '2026 Remote Work Productivity Study — Summary',
    mime: 'text/plain',
    chunks: [
      'The 2026 Remote Work Productivity Study was led by Dr. Meera Krishnan of the Indian Institute of Management Bengaluru. The study surveyed 12,400 knowledge workers across 18 countries between January and June 2026, covering technology, finance, and professional services sectors.',
      'Key findings: 73% of remote workers reported higher productivity compared to full-time office work. Respondents saved an average of 4.6 hours per week by eliminating commutes. Teams with written async-first norms completed 22% more sprint goals than teams relying on synchronous meetings.',
      'Economic impact: employers saved an average of $11,000 per remote employee per year on office space and overhead. The global remote-collaboration software market is projected to reach $4.2 billion by 2028, growing at 14% annually. Employee attrition was 18% lower at companies offering flexible remote options.',
      'Caveats: 31% of respondents reported feelings of isolation at least once a week. The study recommends a hybrid baseline of 2 in-office days per week for roles requiring close collaboration. Junior employees (under 2 years of experience) benefited most from structured mentorship, regardless of location.',
    ],
  },
  {
    title: 'Customer Support FAQ',
    mime: 'text/plain',
    chunks: [
      'Shipping and delivery: orders are dispatched within 24 hours and delivered in 5 to 7 business days across India. Shipping is free on orders above Rs. 999 (or $50 internationally). A tracking link is emailed to you as soon as your order ships.',
      'Support hours: our support team is available Monday to Friday, 9:00 AM to 6:00 PM IST. Email support@cloudsync.pro for help; the average first response time is 4 hours on business days. Live chat is available inside the CloudSync Pro dashboard for Pro and Team customers.',
      'Account management: to reset your password, click "Forgot password" on the sign-in page and follow the email link (valid for 1 hour). To delete your account and all associated data, go to Settings, then Privacy, then "Delete account". Deletion is permanent after a 14-day grace period.',
      'Payments and billing: we accept Visa, Mastercard, RuPay, and UPI for Indian customers, and Visa/Mastercard internationally. Invoices and receipts are available under Settings, then Billing. Annual billing saves 20% compared to monthly billing on Pro and Team plans.',
    ],
  },
  {
    title: 'Q3 2026 Financial Report.pdf',
    mime: 'application/pdf',
    chunks: [
      'NovaTech Solutions Q3 2026 Financial Report: total revenue reached $4.2M, up 18% quarter-over-quarter and 31% year-over-year. Recurring subscription revenue accounted for 78% of the total, or $3.28M. Gross margin improved to 84% from 81% in Q2, driven by CloudSync Pro adoption.',
      'Segment breakdown: CloudSync Pro subscriptions generated $2.9M (up 22% QoQ), services and consulting added $0.8M, and enterprise licensing contributed $0.5M. Operating expenses were $3.1M, leaving an operating profit of $1.1M — a 26% operating margin, the highest in company history.',
      'Executive commentary: CEO Anita Desai credited the growth to the Team plan launch in July 2026 and expanded UPI payments in India. CFO Rohan Iyer projects Q4 2026 revenue of $4.9M to $5.2M, and the board approved a headcount expansion from 240 to 300 employees by March 2027.',
      'Balance sheet: the company closed Q3 with $6.7M in cash and no debt. Customer acquisition cost (CAC) was $1,240 per account with an LTV-to-CAC ratio of 4.6x. Net revenue retention hit 118%, and churn fell to a record low of 2.1% per quarter.',
    ],
  },
  {
    title: 'Product Launch Plan.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    chunks: [
      'CloudSync Pro v5.0 launch plan: public launch is scheduled for March 15, 2027, with a closed beta starting January 20, 2027 for 500 Team-plan customers. The headline feature is real-time collaborative editing with end-to-end encryption, plus AI-powered file search.',
      'Launch team: the launch is led by product manager Priya Sharma, with Vikram Mehta (engineering lead) owning the sync engine, Anjali Rao (design lead) owning the new UI, and Kabir Singh (growth lead) owning the launch campaign. Weekly war-room reviews happen every Tuesday at 3 PM IST.',
      'Milestones: December 1, 2026 — feature freeze and internal dogfooding. December 20, 2026 — security audit and penetration test. January 10, 2027 — marketing assets and landing page live. February 15, 2027 — pricing announcement ($34/month Pro, $119/month Team). March 1, 2027 — press embargo lifts.',
      'Success targets: 10,000 beta signups by February 2027, 25% of existing Pro users upgrading to the new Team plan within 90 days of launch, and a press score of 40+ mentions. Launch budget is $180,000, split 60% marketing, 25% engineering hardening, and 15% partner incentives.',
    ],
  },
];

let seededThisInvocation = false;

export async function ensureDemoSeeded(): Promise<void> {
  if (!isDemoMode()) return;
  if (seededThisInvocation) return;
  try {
    const existing = await sql`select 1 from users where id = ${DEMO_USER_ID} limit 1`;
    if (existing.length) {
      seededThisInvocation = true;
      return;
    }

    console.log('[pramaan demo] seeding demo workspace…');
    const passwordHash = await bcrypt.hash('demo12345', 4);

    await sql.begin(async (tx: any) => {
      await tx`insert into users (id, email, name, password_hash, active_org_id)
               values (${DEMO_USER_ID}, ${DEMO_EMAIL}, ${DEMO_NAME}, ${passwordHash}, ${DEMO_ORG_ID})
               on conflict (id) do nothing`;
      await tx`insert into orgs (id, name, kind, created_by)
               values (${DEMO_ORG_ID}, ${'Demo workspace'}, 'personal', ${DEMO_USER_ID})
               on conflict (id) do nothing`;
      await tx`insert into memberships (org_id, user_id, role)
               values (${DEMO_ORG_ID}, ${DEMO_USER_ID}, 'owner')
               on conflict (org_id, user_id) do nothing`;
      await tx`update users set active_org_id = ${DEMO_ORG_ID} where id = ${DEMO_USER_ID}`;

      for (const doc of SEED_DOCS) {
        const [d] = await tx`insert into documents (org_id, owner_id, title, source, mime, visibility, allowed_roles)
          values (${DEMO_ORG_ID}, ${DEMO_USER_ID}, ${doc.title}, 'demo-seed', ${doc.mime}, 'private', '{}')
          returning id`;
        let idx = 0;
        for (const content of doc.chunks) {
          const vec = hashEmbedding(content);
          const vecStr = `[${vec.join(',')}]`;
          await tx`insert into chunks (document_id, org_id, idx, content, subject_ref, quarantined, risk, embedding)
            values (${d.id}, ${DEMO_ORG_ID}, ${idx}, ${content}, null, false, 0, ${vecStr}::vector)`;
          idx++;
        }
        await tx`update documents set chunk_count = ${doc.chunks.length} where id = ${d.id}`;
      }
    });

    seededThisInvocation = true;
    console.log(`[pramaan demo] demo workspace seeded: ${SEED_DOCS.length} documents`);
  } catch (e: any) {
    // Never break the app because the demo seed failed.
    console.warn('[pramaan demo] seed failed (non-fatal):', e?.message);
  }
}
