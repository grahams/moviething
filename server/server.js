const { createServer } = require('./app');
const port = process.env.SERVER_PORT || 3000;

createServer();

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 