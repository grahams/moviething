'use strict';

function formatViewingDate(date) {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

module.exports = { formatViewingDate };
