const { v4: uuidv4 } = require('uuid');
const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

function getCorrelationId() {
  return asyncLocalStorage.getStore()?.get('correlationId') || 'no-correlation-id';
}

function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  
  const store = new Map();
  store.set('correlationId', correlationId);
  store.set('requestId', uuidv4());
  
  asyncLocalStorage.run(store, () => {
    next();
  });
}

module.exports = { correlationIdMiddleware, getCorrelationId, asyncLocalStorage };
