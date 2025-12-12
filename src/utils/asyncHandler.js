// Wrap les handlers async pour capturer les erreurs automatiquement
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
