function ok(res, data = null, meta = null) {
  return res.json({ success: true, data, meta });
}
function created(res, data = null) {
  return res.status(201).json({ success: true, data });
}
function fail(res, status = 400, message = 'Bad Request', details = null) {
  return res.status(status).json({ success: false, message, details });
}
module.exports = { ok, created, fail };
