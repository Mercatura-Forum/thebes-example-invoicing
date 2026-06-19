import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { createContext, useContext, useState } from 'react';
import { useMemphis } from './useMemphis.js';
const AuthCtx = createContext(null);
/** The Memphis session (signed in or guest). Throws if used outside the gate. */
export function useAuth() {
    const v = useContext(AuthCtx);
    if (!v)
        throw new Error('useAuth must be used inside <MemphisGate>');
    return v;
}
/** Open demo: always render the app. Sign-in is on demand via SignOutChip. */
export function MemphisGate({ children }) {
    const auth = useMemphis();
    return _jsx(AuthCtx.Provider, { value: auth, children: children });
}
/**
 * Header auth control. Guests see a "Sign in" affordance that expands into a
 * name + passkey prompt; signed-in visitors see their name and a sign-out link.
 */
export function SignOutChip({ className = '' }) {
    const auth = useAuth();
    const [name, setName] = useState('');
    const [open, setOpen] = useState(false);
    if (auth.signedIn)
        return (_jsxs("span", { className: `inline-flex items-center gap-2 text-xs ${className}`, children: [_jsxs("span", { className: "opacity-60", children: ["Signed in as ", _jsx("b", { style: { color: 'var(--color-accent)' }, children: auth.displayName })] }), _jsx("button", { className: "rounded-md px-2 py-1 font-medium opacity-80 hover:opacity-100", style: { color: 'var(--color-accent)' }, onClick: auth.signOut, children: "Sign out" })] }));
    const submit = () => { auth.signIn(name.trim() || 'Guest').catch(() => { }); };
    if (!open)
        return (_jsx("button", { className: `rounded-lg px-3 py-1.5 text-xs font-medium ${className}`, style: { color: 'var(--color-accent)', boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent)' }, onClick: () => setOpen(true), children: "Sign in" }));
    return (_jsxs("span", { className: `inline-flex items-center gap-2 ${className}`, children: [_jsx("input", { className: "rounded-lg border border-black/10 bg-black/[0.03] px-2.5 py-1.5 text-sm outline-none", style: { borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)' }, placeholder: "Your name", value: name, autoFocus: true, onChange: (e) => setName(e.target.value), onKeyDown: (e) => e.key === 'Enter' && submit() }), _jsx("button", { className: "rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50", style: { background: 'var(--color-accent)' }, onClick: submit, disabled: auth.busy, children: auth.busy ? 'Signing in…' : 'Sign in with passkey' }), auth.error && _jsx("span", { className: "rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700", children: auth.error })] }));
}
//# sourceMappingURL=MemphisGate.js.map
