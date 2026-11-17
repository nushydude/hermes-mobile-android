export type ModelChoice = {provider:string; providerName:string; model:string; disabled:boolean; reason?:string};
export function modelChoices(value: unknown): ModelChoice[] {
  const data = value && typeof value === 'object' ? value as Record<string,unknown> : {};
  if (!Array.isArray(data.providers)) return [];
  const seen = new Set<string>(), result: ModelChoice[] = [];
  for (const entry of data.providers) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string,unknown>;
    if (typeof p.slug !== 'string' || !p.slug.trim() || !Array.isArray(p.models)) continue;
    const unavailable = new Set(Array.isArray(p.unavailable_models) ? p.unavailable_models : []);
    for (const model of p.models) {
      if (typeof model !== 'string' || !model.trim()) continue;
      const key = JSON.stringify([p.slug, model]); if (seen.has(key)) continue; seen.add(key);
      const reason = p.authenticated === false ? 'Provider authentication required' : unavailable.has(model) ? 'Model unavailable' : undefined;
      result.push({provider:p.slug, providerName:typeof p.name === 'string' && p.name.trim() ? p.name : p.slug, model, disabled:!!reason, ...(reason ? {reason} : {})});
    }
  }
  return result;
}
/** Owner's mobile scope: OpenAI plus saved custom/local providers, not borrowed CLI logins. */
export function mobileModelChoices(value: unknown): ModelChoice[] {
  const data = value && typeof value === 'object' ? value as Record<string,unknown> : {};
  const providers = Array.isArray(data.providers) ? data.providers.filter(entry => {
    if (!entry || typeof entry !== 'object') return false;
    const provider = entry as Record<string,unknown>;
    return provider.slug === 'openai' || provider.slug === 'openai-codex'
      || provider.is_user_defined === true || provider.source === 'user-config' || provider.source === 'local-runtime';
  }) : [];
  return modelChoices({...data, providers});
}
export function sameModel(a: ModelChoice | null, b: ModelChoice | null) { return a === b || (!!a && !!b && a.provider === b.provider && a.model === b.model); }
export function filterModels(options: ModelChoice[], query: string) {
  const q = query.trim().toLocaleLowerCase(); return q ? options.filter(option => `${option.providerName} ${option.provider} ${option.model}`.toLocaleLowerCase().includes(q)) : options;
}
export function recentWorkspaces(rows: readonly {cwd?: unknown}[]) {
  const seen = new Set<string>(), result:string[] = [];
  for (const row of rows) if (typeof row.cwd === 'string' && row.cwd.trim() && !seen.has(row.cwd)) { seen.add(row.cwd); result.push(row.cwd); }
  return result;
}
export function filterWorkspaces(options:string[], query:string) { const q = query.trim().toLocaleLowerCase(); return q ? options.filter(option => option.toLocaleLowerCase().includes(q)) : options; }

export function workspaceName(value: unknown) {
  if (typeof value !== 'string') return '';
  const path = value.replace(/[\\/]+$/, ''); return path.split(/[\\/]/).pop() || path;
}
