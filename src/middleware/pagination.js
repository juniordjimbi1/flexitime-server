// server/src/middleware/pagination.js

/**
 * withPagination : parse & normalise page/limit/sort depuis query
 * - page: >=1 (defaut 1)
 * - limit: [1..200] (defaut 20)
 * - sort: "col:asc|desc,col2:desc"
 *
 * Met sur req.pagination = { page, limit, offset, sort: [{col,dir}, ...] }
 * NOTE: Les contrôleurs peuvent ignorer req.pagination s'ils n'en ont pas besoin.
 */
function withPagination(req, _res, next) {
  const q = req.query || {};

  let page = Number(q.page || 1);
  if (!Number.isInteger(page) || page < 1) page = 1;

  let limit = Number(q.limit || 20);
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > 200) limit = 200;

  const offset = (page - 1) * limit;

  const sortSpec = typeof q.sort === 'string' ? q.sort : '';
  const sort = [];
  if (sortSpec) {
    // Exemple: "created_at:desc,name:asc"
    for (const token of sortSpec.split(',')) {
      const [colRaw, dirRaw] = token.split(':').map(s => (s || '').trim());
      if (!colRaw) continue;
      const dir = (dirRaw || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      // Sécurité basique: whitelisting minimal chars pour un identifiant SQL
      if (!/^[a-zA-Z0-9_]+$/.test(colRaw)) continue;
      sort.push({ col: colRaw, dir });
    }
  }

  req.pagination = { page, limit, offset, sort };
  next();
}

module.exports = { withPagination };
