const VERSION_X_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function previewDeployment(env) {
  return String(env?.VERCEL_ENV || '').trim().toLowerCase() === 'preview';
}

export function versionXStorageNamespace(env = process.env) {
  const value = String(env?.POOL_SIDE_X_NAMESPACE || '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  if (!VERSION_X_NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(
      'POOL_SIDE_X_NAMESPACE must start with a letter or number and contain only letters, numbers, underscores, or hyphens (40 characters maximum).'
    );
  }
  return value;
}

export function versionXStorageNamespaceReadiness(env = process.env) {
  const required = previewDeployment(env);
  try {
    const namespace = versionXStorageNamespace(env);
    return Object.freeze({
      ready: !required || Boolean(namespace),
      required,
      namespace,
      reason: required && !namespace ? 'missing' : ''
    });
  } catch {
    return Object.freeze({
      ready: false,
      required,
      namespace: '',
      reason: 'invalid'
    });
  }
}

export function requireVersionXStorageNamespace(env = process.env) {
  const namespace = versionXStorageNamespace(env);
  if (previewDeployment(env) && !namespace) {
    throw new TypeError(
      'POOL_SIDE_X_NAMESPACE is required for a Vercel Preview deployment.'
    );
  }
  return namespace;
}

export function versionXStorageKey(base, env = process.env) {
  const namespace = requireVersionXStorageNamespace(env);
  return namespace
    ? `${String(base)}:namespace:${namespace}`
    : String(base);
}

export function versionXStorageTag(base, env = process.env) {
  const namespace = requireVersionXStorageNamespace(env);
  return `{${String(base)}${namespace ? `-${namespace}` : ''}}`;
}
