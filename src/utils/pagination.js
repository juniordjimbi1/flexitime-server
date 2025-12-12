// server/src/utils/pagination.js
function parsePagination(req) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
function meta(total, page, limit) {
  const pages = Math.ceil(total / limit) || 0;
  return { page, limit, total, pages };
}
module.exports = { parsePagination, meta };
