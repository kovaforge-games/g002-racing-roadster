// lets the Worker tests import worker/index.ts under Node: cloudflare:workers becomes a stub
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
  return next(specifier, context);
}
