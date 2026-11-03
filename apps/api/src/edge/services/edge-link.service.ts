import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  EDGE_TOKEN_PATTERN,
  type EdgeLinkRequest,
  type EdgeLinkResponseWire,
  type EdgeLinkState,
} from '@tugeel/shared/pos';
import { AppError, invalid } from '../../common/errors/app-error';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeLink } from '../db/schema';

/** How the edge reaches its centre, from whichever source linked it. */
export interface CentralLink {
  source: 'env' | 'code';
  centralUrl: string;
  token: string;
  pinKey: Buffer;
  nodeCode: string | null;
  nodeName: string | null;
  linkedAt: Date | null;
}

const LINK_TIMEOUT_MS = 15_000;
const LINK_ERRORS = new Set(['EDGE_LINK_INVALID', 'EDGE_LINK_PEPPER_MISSING']);

/**
 * ADR-0136: the edge's tie to its centre. `deploy/edge/.env` may name it (the token and PIN key
 * typed there, as before); otherwise the kiosk links a new edge with the node's code and an
 * admin's one-time code, and the answer — the token and the PIN key — is kept in `edge_link`.
 * A code-linked edge whose token the centre refuses (a new one was issued) may link again, to the
 * same node only.
 */
@Injectable()
export class EdgeLinkService implements OnModuleInit {
  private link: CentralLink | null = null;
  private rejected = false;

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly config: EdgeConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get('EDGE_NODE_TOKEN');
    const pepper = this.config.get('POS_PIN_PEPPER');
    const url = this.config.get('CENTRAL_API_URL');
    if (token && pepper && url) {
      this.link = {
        source: 'env',
        centralUrl: url,
        token,
        pinKey: Buffer.from(pepper),
        nodeCode: null,
        nodeName: null,
        linkedAt: null,
      };
      return;
    }
    const [row] = await this.db.select().from(edgeLink);
    if (row) {
      this.link = {
        source: 'code',
        centralUrl: row.centralUrl,
        token: row.token,
        pinKey: Buffer.from(row.pinPepper),
        nodeCode: row.nodeCode,
        nodeName: row.nodeName,
        linkedAt: row.linkedAt,
      };
    }
  }

  current(): CentralLink | null {
    return this.link;
  }

  /** The key the PIN hashes were made with; empty (nothing verifies) before the edge is linked. */
  pinKey(): Buffer {
    return this.link?.pinKey ?? Buffer.alloc(0);
  }

  /** The centre answered 401 to the token: a code-linked edge may link again. */
  markRejected(): void {
    this.rejected = true;
  }

  markAccepted(): void {
    this.rejected = false;
  }

  state(): EdgeLinkState {
    const link = this.link;
    return {
      linked: link !== null,
      source: link?.source ?? null,
      centralUrl: link?.centralUrl ?? null,
      nodeCode: link?.nodeCode ?? null,
      nodeName: link?.nodeName ?? null,
      linkedAt: link?.linkedAt?.toISOString() ?? null,
      rejected: this.rejected,
    };
  }

  /**
   * Links this edge: the centre's address, the node's code and the admin's one-time code. The call
   * to the centre is made before anything is written; the answer replaces the row.
   */
  async linkWith(request: EdgeLinkRequest): Promise<EdgeLinkState> {
    const nodeCode = request.nodeCode.trim().toUpperCase();
    const current = this.link;
    if (current && (current.source === 'env' || !this.rejected || current.nodeCode !== nodeCode)) {
      throw new AppError('EDGE_ALREADY_LINKED', 'this edge is linked to its centre already');
    }
    const centralUrl = centralBase(request.centralUrl);
    if (!centralUrl) throw invalid('centralUrl', 'url', 'http://<address>:<port>');
    let response: Response;
    try {
      response = await fetch(`${centralUrl}/api/v1/pos/edge-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ nodeCode, linkCode: request.linkCode }),
        signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
      });
    } catch {
      throw new AppError('EDGE_LINK_UNREACHABLE', 'the centre did not answer', { centralUrl });
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as { code?: string } | null;
      const code = problem?.code;
      if (code && LINK_ERRORS.has(code)) {
        throw new AppError(code as 'EDGE_LINK_INVALID', `the centre refused the link (${code})`);
      }
      throw new AppError('EDGE_LINK_UNREACHABLE', `the centre answered ${response.status}`, {
        centralUrl,
      });
    }
    const answer = (await response.json().catch(() => null)) as EdgeLinkResponseWire | null;
    if (
      !answer ||
      !EDGE_TOKEN_PATTERN.test(answer.token) ||
      typeof answer.pinPepper !== 'string' ||
      answer.pinPepper.length < 32
    ) {
      throw new AppError('EDGE_LINK_UNREACHABLE', 'the centre gave no usable link', { centralUrl });
    }
    const values = {
      centralUrl,
      nodeId: answer.nodeId,
      nodeCode: answer.nodeCode,
      nodeName: answer.nodeName,
      token: answer.token,
      pinPepper: answer.pinPepper,
      linkedAt: new Date(),
    };
    await this.db
      .insert(edgeLink)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: edgeLink.id, set: values });
    this.link = {
      source: 'code',
      centralUrl,
      token: answer.token,
      pinKey: Buffer.from(answer.pinPepper),
      nodeCode: answer.nodeCode,
      nodeName: answer.nodeName,
      linkedAt: values.linkedAt,
    };
    this.rejected = false;
    return this.state();
  }
}

/** `http(s)://host[:port]` without a path or a trailing slash, or null when it is not one. */
function centralBase(value: string): string | null {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
