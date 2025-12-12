// 404 + gestionnaire d’erreurs centralisé
function notFound(req, res, next) {
  res.status(404).json({ success: false, message: 'Not Found' });
}

function errorHandler(err, req, res, next) {
  console.error('API Error:', err); 
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
}

module.exports = { notFound, errorHandler };
