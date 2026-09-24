export function safeDevelopmentPath(path) {
  return typeof path === 'string' && path.length < 300 && !path.includes('\\') && !path.startsWith('/') &&
    !path.split('/').some(p => !p || p === '..' || p === '.' || /^(?:\.git|\.env(?:\..*)?|\.ssh|\.npmrc|\.aws|\.azure|node_modules)$/i.test(p)) &&
    !/(^|\/)(?:nuget\.config|appsettings(?:\.[^/]+)?\.json|config\.(?:php|txt)|[^/]+\.(?:pem|pfx|p12|key))$/i.test(path) &&
    !/[:\x00-\x1f]/.test(path);
}
