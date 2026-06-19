/**
 * MemphisGate — open-demo wrapper with Memphis passkey sign-in on demand.
 *
 * This is a public demo: anyone can roam the app without signing in. The gate
 * always renders the app and exposes the Memphis session (guest or signed-in)
 * via useAuth(). Sign-in is offered in the header (SignOutChip) and prompted
 * only when a visitor wants a persistent identity. Memphis (cid 921) provides
 * the human display name; the on-chain caller is the boundary's persisted
 * browser key either way, so reads and writes work for guests too.
 *
 * Same API as every Thebes example: wrap routes in <MemphisGate>, read the
 * session via useAuth(), sign in / out via SignOutChip. The accent comes from
 * the per-app `--color-accent` token (in index.css).
 */
import { type ReactNode } from 'react';
import { type MemphisAuth } from './useMemphis.js';
/** The Memphis session (signed in or guest). Throws if used outside the gate. */
export declare function useAuth(): MemphisAuth;
export declare function MemphisGate({ children }: {
    appName?: string;
    tagline?: string;
    children: ReactNode;
}): import("react").JSX.Element;
/** Header auth control: guests get a "Sign in" affordance; signed-in visitors
 *  see their name and a sign-out link. The accent comes from --color-accent. */
export declare function SignOutChip({ className }: {
    className?: string;
}): import("react").JSX.Element;
//# sourceMappingURL=MemphisGate.d.ts.map
