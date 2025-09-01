const { Hono } = require('hono');

const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Welcome to Hono Node.js Starter!' });
});

app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from Hono API!' });
});

module.exports = app;
