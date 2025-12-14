require('dotenv').config();
const app = require('./app');

// --- SERVE REACT BUILD IN PRODUCTION ---

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

