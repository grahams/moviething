'use strict';

function validate(schema) {
  return (req, res, next) => {
    if (!req.body || !req.body.json) {
      return res.status(400).json({ error: 'Missing request body' });
    }
    let parsed;
    try {
      parsed = JSON.parse(req.body.json);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = { validate };
